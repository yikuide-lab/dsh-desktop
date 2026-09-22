/**
 * Shared executor loop: registration (0600 credentials), long-poll claim URL,
 * register payload (concurrency/labels), credential reuse, and honest
 * runTask result propagation. Fetch is scripted, following the desktop
 * awf-executor spec pattern.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AwfFetch } from '../src/awf/client.js'
import { defaultAwfSettings, writeAwfSettings } from '../src/awf/settings.js'
import {
  awfExecutorCredentialsPath,
  createAwfExecutorLoop,
  type AwfClaimedTask,
  type AwfTaskResult,
} from '../src/awf/executor.js'

const tmpDirs: string[] = []
afterEach(async () => {
  while (tmpDirs.length) await rm(tmpDirs.pop()!, { recursive: true, force: true })
})

async function newTmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'awf-loop-spec-'))
  tmpDirs.push(dir)
  // 凭据落在 stateDir 的上级目录：用嵌套子目录避免测试间共享
  return join(dir, 'workflow')
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function until(condition: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return true
    await delay(10)
  }
  return condition()
}

type Handler = (method: string, url: string, body: unknown) => { status: number; body: unknown } | null

function scriptedFetch(handlers: Handler[]): { fetchImpl: AwfFetch; requests: Array<{ method: string; url: string; body: unknown; auth: string | null }> } {
  const requests: Array<{ method: string; url: string; body: unknown; auth: string | null }> = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) : null
    const auth = (init?.headers as Record<string, string>)?.Authorization ?? null
    requests.push({ method, url, body, auth })
    for (const handler of handlers) {
      const out = handler(method, url, body)
      if (out) return new Response(JSON.stringify(out.body), { status: out.status })
    }
    return new Response(JSON.stringify({ detail: 'not found' }), { status: 404 })
  }) as AwfFetch
  return { fetchImpl, requests }
}

const TASK: AwfClaimedTask = {
  id: 11,
  workflow_name: 'exe-task',
  step_id: 'delegate',
  payload: { prompt: 'do the thing', params: {} },
  deadline_at: null,
}

const okRunTask = (): (task: AwfClaimedTask) => Promise<AwfTaskResult> =>
  async (task) => ({ ok: true, output: `done:${task.id}` })

describe('awf executor loop (shared)', () => {
  it('isEnabled=false → start ignored, no requests', async () => {
    const dir = await newTmp()
    const { fetchImpl, requests } = scriptedFetch([() => null])
    const loop = createAwfExecutorLoop({
      stateDir: dir,
      fetchImpl,
      isEnabled: async () => false,
      runTask: okRunTask(),
    })
    loop.start()
    await delay(50)
    expect(requests).toHaveLength(0)
    expect(loop.status().running).toBe(false)
    await loop.stop()
  })

  it('register (0600 creds, user JWT) → claim?wait_sec → runTask → result', async () => {
    const dir = await newTmp()
    await writeAwfSettings(dir, { ...defaultAwfSettings(), apiToken: 'user_jwt' })
    let claimCount = 0
    const { fetchImpl, requests } = scriptedFetch([
      (method, url) => {
        if (method === 'POST' && url.includes('/api/executors/register')) {
          return { status: 200, body: { executor_id: 7, token: 'exe_tok_1' } }
        }
        if (method === 'POST' && url.includes('/api/executors/claim')) {
          claimCount += 1
          return { status: 200, body: { task: claimCount === 1 ? TASK : null } }
        }
        if (method === 'POST' && url.includes('/api/executors/tasks/11/result')) {
          return { status: 200, body: { ok: true } }
        }
        return null
      },
    ])
    const loop = createAwfExecutorLoop({
      stateDir: dir,
      fetchImpl,
      claimIntervalMs: 10_000,
      claimWaitSec: 25,
      concurrency: 4,
      labels: { region: 'test', gpu: 'none' },
      runTask: okRunTask(),
    })
    loop.start()
    await until(() => requests.some((r) => r.url.includes('/api/executors/tasks/11/result')))
    await loop.stop()

    const registerReq = requests.find((r) => r.url.includes('/api/executors/register'))
    expect(registerReq).toBeDefined()
    expect(registerReq!.auth).toBe('Bearer user_jwt')
    expect(registerReq!.body).toMatchObject({
      capabilities: { task: true },
      concurrency: 4,
      labels: { region: 'test', gpu: 'none' },
    })
    const credPath = awfExecutorCredentialsPath(dir)
    expect(((await stat(credPath)).mode & 0o777)).toBe(0o600)
    const creds = JSON.parse(await readFile(credPath, 'utf8')) as { executorId: number; token: string }
    expect(creds).toEqual({ executorId: 7, token: 'exe_tok_1' })

    const claimReq = requests.find((r) => r.url.includes('/api/executors/claim'))
    expect(claimReq!.url).toContain('wait_sec=25')
    expect(claimReq!.auth).toBe('Bearer exe_tok_1')

    const resultReq = requests.find((r) => r.url.includes('/api/executors/tasks/11/result'))
    expect(resultReq!.body).toEqual({ ok: true, output: 'done:11' })
    expect(loop.status().registered).toBe(true)
    expect(loop.status().executorId).toBe(7)
  })

  it('runTask failure is posted honestly as ok=false', async () => {
    const dir = await newTmp()
    await writeAwfSettings(dir, { ...defaultAwfSettings(), apiToken: 'user_jwt' })
    let claimCount = 0
    const { fetchImpl, requests } = scriptedFetch([
      (method, url) => {
        if (method === 'POST' && url.includes('/api/executors/register')) {
          return { status: 200, body: { executor_id: 8, token: 'exe_tok_2' } }
        }
        if (method === 'POST' && url.includes('/api/executors/claim')) {
          claimCount += 1
          return { status: 200, body: { task: claimCount === 1 ? TASK : null } }
        }
        if (method === 'POST' && url.includes('/api/executors/tasks/11/result')) {
          return { status: 200, body: { ok: true } }
        }
        return null
      },
    ])
    const loop = createAwfExecutorLoop({
      stateDir: dir,
      fetchImpl,
      claimIntervalMs: 10_000,
      runTask: async () => ({ ok: false, error: 'no LLM endpoint configured' }),
    })
    loop.start()
    await until(() => requests.some((r) => r.url.includes('/api/executors/tasks/11/result')))
    await loop.stop()
    const resultReq = requests.find((r) => r.url.includes('/api/executors/tasks/11/result'))
    expect(resultReq!.body).toEqual({ ok: false, error: 'no LLM endpoint configured' })
  })

  it('reuses persisted credentials when /me accepts them (no register)', async () => {
    const dir = await newTmp()
    await writeAwfSettings(dir, defaultAwfSettings())
    const credPath = awfExecutorCredentialsPath(dir)
    await mkdir(dirname(credPath), { recursive: true })
    await writeFile(credPath, `${JSON.stringify({ executorId: 3, token: 'exe_saved' })}\n`, { encoding: 'utf8', mode: 0o600 })
    const { fetchImpl, requests } = scriptedFetch([
      (method, url) => {
        if (method === 'GET' && url.includes('/api/executors/me')) return { status: 200, body: { executor_id: 3 } }
        if (method === 'POST' && url.includes('/api/executors/claim')) return { status: 200, body: { task: null } }
        return null
      },
    ])
    const loop = createAwfExecutorLoop({
      stateDir: dir,
      fetchImpl,
      claimIntervalMs: 10_000,
      runTask: okRunTask(),
    })
    loop.start()
    await until(() => requests.some((r) => r.url.includes('/api/executors/claim')))
    await loop.stop()
    expect(requests.find((r) => r.url.includes('/api/executors/register'))).toBeUndefined()
    // claimWaitSec 默认 0：经典轮询，无 wait_sec 参数
    expect(requests.find((r) => r.url.includes('/api/executors/claim'))!.url).not.toContain('wait_sec')
  })

  it('env token wins over saved token for registration', async () => {
    const dir = await newTmp()
    await writeAwfSettings(dir, { ...defaultAwfSettings(), apiToken: 'saved_jwt' })
    const { fetchImpl, requests } = scriptedFetch([
      (method, url) => {
        if (method === 'POST' && url.includes('/api/executors/register')) {
          return { status: 200, body: { executor_id: 9, token: 'exe_tok_3' } }
        }
        if (method === 'POST' && url.includes('/api/executors/claim')) return { status: 200, body: { task: null } }
        return null
      },
    ])
    const loop = createAwfExecutorLoop({
      stateDir: dir,
      fetchImpl,
      env: { AWF_API_TOKEN: 'env_jwt' },
      claimIntervalMs: 10_000,
      runTask: okRunTask(),
    })
    loop.start()
    await until(() => requests.some((r) => r.url.includes('/api/executors/claim')))
    await loop.stop()
    const registerReq = requests.find((r) => r.url.includes('/api/executors/register'))
    expect(registerReq!.auth).toBe('Bearer env_jwt')
  })
})
