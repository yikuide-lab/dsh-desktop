/**
 * End-to-end smoke: `serve()` against a scripted local AWF platform
 * (node:http) proves register → claim (long-poll) → execute (script step on
 * the real workflow engine) → result, plus graceful stop.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from '../src/serve.js'

const tmpDirs: string[] = []
const servers: Server[] = []
afterEach(async () => {
  while (servers.length) servers.pop()!.close()
  while (tmpDirs.length) await rm(tmpDirs.pop()!, { recursive: true, force: true })
})

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function until(condition: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return true
    await delay(25)
  }
  return condition()
}

interface MockPlatform {
  url: string
  requests: Array<{ method: string; url: string; body: unknown; auth: string | null }>
}

async function mockPlatform(): Promise<MockPlatform> {
  const requests: MockPlatform['requests'] = []
  let claimCount = 0
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => { raw += chunk.toString() })
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) as unknown : null
      requests.push({
        method: req.method ?? 'GET',
        url: req.url ?? '',
        body,
        auth: typeof req.headers.authorization === 'string' ? req.headers.authorization : null,
      })
      const send = (status: number, payload: unknown): void => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
      }
      const url = req.url ?? ''
      if (req.method === 'POST' && url === '/api/executors/register') {
        send(200, { executor_id: 42, token: 'exe_tok_smoke' })
        return
      }
      if (req.method === 'GET' && url === '/api/executors/me') {
        send(200, { executor_id: 42 })
        return
      }
      if (req.method === 'POST' && url.startsWith('/api/executors/claim')) {
        claimCount += 1
        send(200, {
          task: claimCount === 1
            ? {
              id: 101,
              workflow_name: 'publisher-flow',
              step_id: 'main',
              payload: { type: 'script', run: 'echo awf-smoke-ok', params: {} },
              deadline_at: null,
            }
            : null,
        })
        return
      }
      if (req.method === 'POST' && url === '/api/executors/tasks/101/result') {
        send(200, { ok: true })
        return
      }
      if (req.method === 'POST' && url === '/api/executors/heartbeat') {
        send(200, { ok: true })
        return
      }
      send(404, { detail: 'not found' })
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, requests }
}

describe('awf-node serve (e2e smoke)', () => {
  it('register → claim?wait_sec → script step on the engine → result posted', async () => {
    const platform = await mockPlatform()
    const stateDir = await mkdtemp(join(tmpdir(), 'awf-node-e2e-'))
    tmpDirs.push(stateDir)

    const handle = await serve({
      stateDir,
      platform: platform.url,
      env: { AWF_API_TOKEN: 'user_jwt_smoke' },
      claimWaitSec: 5,
      heartbeatMs: 200,
      claimIntervalMs: 10_000,
      engineTickMs: 50,
      logger: () => {},
    })
    try {
      const finished = await until(() => (
        platform.requests.some((r) => r.url === '/api/executors/tasks/101/result')
      ))
      expect(finished).toBe(true)

      const registerReq = platform.requests.find((r) => r.url === '/api/executors/register')
      expect(registerReq!.auth).toBe('Bearer user_jwt_smoke')
      expect(registerReq!.body).toMatchObject({
        capabilities: { task: true, script: true, llm: false },
      })

      const claimReq = platform.requests.find((r) => r.url.startsWith('/api/executors/claim'))
      expect(claimReq!.url).toContain('wait_sec=5')
      expect(claimReq!.auth).toBe('Bearer exe_tok_smoke')

      const resultReq = platform.requests.find((r) => r.url === '/api/executors/tasks/101/result')
      expect(resultReq!.auth).toBe('Bearer exe_tok_smoke')
      expect(resultReq!.body).toMatchObject({ ok: true })
      expect(String((resultReq!.body as { output?: string }).output)).toContain('awf-smoke-ok')

      expect(handle.status().registered).toBe(true)
      expect(handle.status().executorId).toBe(42)
    } finally {
      await handle.stop()
    }
    expect(handle.status().running).toBe(false)
  }, 30_000)
})
