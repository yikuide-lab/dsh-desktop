/**
 * awf-a3c S-P4 桌面侧 PoC：执行器开关默认关、注册凭据 0600 落盘、
 * 认领→执行→回传闭环（无宿主服务时诚实失败），以及凭据复用。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AwfFetch } from '../src/desktop-awf-client.ts'
import { defaultAwfSettings, writeAwfSettings } from '../src/desktop-awf-settings.ts'
import {
  awfExecutorCredentialsPath,
  createAwfExecutor,
} from '../src/desktop-awf-executor.ts'

const tmpDirs: string[] = []
afterEach(async () => {
  while (tmpDirs.length) await rm(tmpDirs.pop()!, { recursive: true, force: true })
})

async function newTmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'awf-executor-spec-'))
  tmpDirs.push(dir)
  // 模块把凭据放在 stateDir 的上级目录：stateDir 用嵌套子目录避免测试间共享
  return join(dir, 'workflow')
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
/** 并行跑测试时固定延时易抖动：条件轮询，最多 2s。 */
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

const TASK = {
  id: 11,
  workflow_name: 'exe-task',
  step_id: 'delegate',
  payload: {
    prompt: '在桌面工作区里跑一遍构建检查',
    inputs: { workspace: '/tmp' },
    outputs: ['report'],
    acceptance: ['done'],
    params: { workspace: '/tmp' },
  },
  deadline_at: null,
}

describe('awf executor (S-P4 桌面 PoC)', () => {
  it('默认关闭：start() 直接忽略，无任何网络行为', async () => {
    const dir = await newTmp()
    const { fetchImpl, requests } = scriptedFetch([() => null])
    const controller = createAwfExecutor({ stateDir: dir, fetchImpl })
    controller.start()
    await delay(50)
    expect(requests).toHaveLength(0)
    expect(controller.status().running).toBe(false)
    await controller.stop()
  })

  it('开启后：注册（凭据 0600 落盘）→ 认领 → 无宿主服务诚实失败回传', async () => {
    const dir = await newTmp()
    // 保存式用户凭据（env 未设置时使用），供注册一次执行器
    await writeAwfSettings(dir, { ...defaultAwfSettings(), executorEnabled: true, apiToken: 'user_jwt' })
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
          return { status: 200, body: { ok: true, status: 'done' } }
        }
        return null
      },
    ])
    const controller = createAwfExecutor({ stateDir: dir, fetchImpl, claimIntervalMs: 10_000 })
    controller.start()
    await until(() => requests.some((r) => r.url.includes('/api/executors/tasks/11/result')))
    await controller.stop()

    // 注册请求带用户 JWT；凭据文件 0600
    const registerReq = requests.find((r) => r.url.includes('/api/executors/register'))
    expect(registerReq).toBeDefined()
    expect(registerReq!.auth).toBe('Bearer user_jwt')
    const credPath = awfExecutorCredentialsPath(dir)
    const credentials = JSON.parse(await readFile(credPath, 'utf8')) as { executorId: number; token: string }
    expect(credentials.executorId).toBe(7)
    expect(((await stat(credPath)).mode & 0o777)).toBe(0o600)
    // 认领请求带执行器 token
    const claimReq = requests.find((r) => r.url.includes('/api/executors/claim'))
    expect(claimReq!.auth).toBe('Bearer exe_tok_1')
    // 无宿主 agents 服务 → 诚实失败回传
    const resultReq = requests.find((r) => r.url.includes('/api/executors/tasks/11/result'))
    expect(resultReq).toBeDefined()
    expect((resultReq!.body as { ok: boolean }).ok).toBe(false)
    expect(String((resultReq!.body as { error: string }).error)).toContain('agents')
    expect(controller.status().registered).toBe(true)
    expect(controller.status().executorId).toBe(7)
  })

  it('凭据复用：/me 通过则不再注册', async () => {
    const dir = await newTmp()
    await writeAwfSettings(dir, { ...defaultAwfSettings(), executorEnabled: true })
    const { writeFile: wf, mkdir } = await import('node:fs/promises')
    const { dirname } = await import('node:path')
    const credPath = awfExecutorCredentialsPath(dir)
    await mkdir(dirname(credPath), { recursive: true })
    await wf(credPath, `${JSON.stringify({ executorId: 3, token: 'exe_saved' })}\n`, { encoding: 'utf8', mode: 0o600 })
    const { fetchImpl, requests } = scriptedFetch([
      (method, url) => {
        if (method === 'GET' && url.includes('/api/executors/me')) return { status: 200, body: { executor_id: 3 } }
        if (method === 'POST' && url.includes('/api/executors/claim')) return { status: 200, body: { task: null } }
        return null
      },
    ])
    const controller = createAwfExecutor({ stateDir: dir, fetchImpl, claimIntervalMs: 10_000 })
    controller.start()
    await until(() => requests.some((r) => r.url.includes('/api/executors/claim')))
    await controller.stop()
    expect(requests.find((r) => r.url.includes('/api/executors/register'))).toBeUndefined()
    const claimReq = requests.find((r) => r.url.includes('/api/executors/claim'))
    expect(claimReq!.auth).toBe('Bearer exe_saved')
  })

  it('真实 agent 路径：宿主服务可用时回传 ok 输出', async () => {
    const dir = await newTmp()
    await writeAwfSettings(dir, { ...defaultAwfSettings(), executorEnabled: true, apiToken: 'user_jwt' })
    let claimCount = 0
    const { fetchImpl, requests } = scriptedFetch([
      (method, url) => {
        if (method === 'POST' && url.includes('/api/executors/register')) {
          return { status: 200, body: { executor_id: 5, token: 'exe_tok_2' } }
        }
        if (method === 'POST' && url.includes('/api/executors/claim')) {
          claimCount += 1
          return { status: 200, body: { task: claimCount === 1 ? TASK : null } }
        }
        if (method === 'POST' && url.includes('/api/executors/tasks/11/result')) {
          return { status: 200, body: { ok: true, status: 'done' } }
        }
        return null
      },
    ])
    const fakeHandle = {
      agent: {
        followup: (): void => {},
        whenIdle: () => Promise.resolve(),
        cancel: async (): Promise<void> => {},
        session: {
          snapshotEvents: () => [
            {
              type: 'assistant/message',
              data: { message: { content: [{ type: 'text', text: '构建检查完成，输出 done' }] } },
            },
          ],
        },
      },
      dispose: (): Promise<void> => Promise.resolve(),
    }
    const controller = createAwfExecutor({
      stateDir: dir,
      fetchImpl,
      getHostServices: () => ({
        llm: { stream: async function* () {} },
        agents: {
          create: async () => fakeHandle,
        } as never,
      }) as never,
    })
    controller.start()
    await until(() => requests.some((r) => r.url.includes('/api/executors/tasks/11/result')))
    await controller.stop()
    const resultReq = requests.find((r) => r.url.includes('/api/executors/tasks/11/result'))
    expect(resultReq).toBeDefined()
    const body = resultReq!.body as { ok: boolean; output?: string }
    expect(body.ok).toBe(true)
    expect(body.output).toContain('done')
  })
})
