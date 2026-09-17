/**
 * awf-a3c C-P4 桌面侧：遥测开关（默认关→零出站请求）、摘要内容、
 * 失败入队/恢复补发，以及 startRun 包装的终态观察。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Run, Task } from 'dsh-plugin-workflow/engine'
import { TaskStatus, WorkflowStatus } from 'dsh-plugin-workflow/engine'
import { createAwfClient, type AwfFetch } from '../src/desktop-awf-client.ts'
import {
  defaultAwfSettings,
  writeAwfSettings,
} from '../src/desktop-awf-settings.ts'
import {
  attachRunTelemetry,
  awfTelemetryPendingPath,
  createAwfTelemetry,
  summarizeRun,
} from '../src/desktop-awf-telemetry.ts'

const tmpDirs: string[] = []
afterEach(async () => {
  while (tmpDirs.length) await rm(tmpDirs.pop()!, { recursive: true, force: true })
})

async function newTmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'awf-telemetry-spec-'))
  tmpDirs.push(dir)
  // 模块把待发队列放在 stateDir 的上级目录：stateDir 用嵌套子目录避免测试间共享
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

function makeRun(overrides: Partial<Run> = {}): Run {
  const task = (stepId: string, status: TaskStatus): Task => ({
    id: `t-${stepId}`,
    stepId,
    status,
    dispatches: [],
  })
  return {
    id: 'run_abc123',
    workflowName: 'daily-report',
    status: WorkflowStatus.Completed,
    tasks: {
      say: task('say', TaskStatus.Completed),
      review: task('review', TaskStatus.Failed),
    },
    gates: {},
    startedAt: '2026-09-17T00:00:00.000Z',
    completedAt: '2026-09-17T00:00:10.000Z',
    ...overrides,
  }
}

type RecordedRequest = { method: string; url: string; body: unknown }

function recordingFetch(
  responder: (method: string, url: string, body: unknown) => { status: number; body: unknown },
): { fetchImpl: AwfFetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) : null
    requests.push({ method, url, body })
    const out = responder(method, url, body)
    return new Response(JSON.stringify(out.body), { status: out.status })
  }) as AwfFetch
  return { fetchImpl, requests }
}

async function enableTelemetry(dir: string): Promise<void> {
  await writeAwfSettings(dir, { ...defaultAwfSettings(), telemetryEnabled: true })
}

describe('awf telemetry (C-P4 桌面侧)', () => {
  it('默认关闭：record 不产生出站请求、不落盘任何摘要', async () => {
    const dir = await newTmp()
    const { fetchImpl, requests } = recordingFetch(() => ({ status: 200, body: { ok: true, id: 1 } }))
    const controller = createAwfTelemetry({ stateDir: dir, fetchImpl })
    controller.record(makeRun())
    await delay(50)
    expect(requests).toHaveLength(0)
    await expect(readFile(awfTelemetryPendingPath(dir), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('开启后上报摘要：只含元数据，成功后清空待发队列', async () => {
    const dir = await newTmp()
    await enableTelemetry(dir)
    const { fetchImpl, requests } = recordingFetch(() => ({ status: 200, body: { ok: true, id: 1 } }))
    const controller = createAwfTelemetry({ stateDir: dir, fetchImpl })
    controller.record(makeRun())
    await until(() => requests.some((r) => r.url.includes('/api/telemetry/runs')))
    const telemetry = requests.filter((r) => r.url.includes('/api/telemetry/runs'))
    expect(telemetry).toHaveLength(1)
    const payload = telemetry[0]!.body as Record<string, unknown>
    expect(payload.workflow_name).toBe('daily-report')
    expect(payload.run_ref).toBe('run_abc123')
    expect(payload.duration_ms).toBe(10_000)
    expect(JSON.stringify(payload)).not.toContain('prompt')
    // 队列清空
    await until(async () => {
      try {
        await readFile(awfTelemetryPendingPath(dir), 'utf8')
        return false
      } catch {
        return true
      }
    })
  })

  it('平台不可达：摘要进入 0600 待发队列，恢复后补发', async () => {
    const dir = await newTmp()
    await enableTelemetry(dir)
    const failing = recordingFetch(() => ({ status: 503, body: { detail: 'down' } }))
    const controller = createAwfTelemetry({ stateDir: dir, fetchImpl: failing.fetchImpl })
    controller.record(makeRun())
    const pendingPath = awfTelemetryPendingPath(dir)
    await until(async () => {
      try {
        return (JSON.parse(await readFile(pendingPath, 'utf8')) as unknown[]).length === 1
      } catch {
        return false
      }
    })
    const mode = (await stat(pendingPath)).mode & 0o777
    expect(mode).toBe(0o600)

    const healthy = recordingFetch(() => ({ status: 200, body: { ok: true, id: 1 } }))
    const second = createAwfTelemetry({ stateDir: dir, fetchImpl: healthy.fetchImpl })
    const flushed = await second.flush()
    expect(flushed).toEqual({ sent: 1, kept: 0 })
    await expect(readFile(pendingPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('待发队列有界（maxPending，丢弃最旧）', async () => {
    const dir = await newTmp()
    await enableTelemetry(dir)
    const failing = recordingFetch(() => ({ status: 503, body: {} }))
    const controller = createAwfTelemetry({ stateDir: dir, fetchImpl: failing.fetchImpl, maxPending: 2 })
    for (let i = 0; i < 5; i += 1) {
      controller.record(makeRun({ id: `run_${i}` }))
      await delay(5)
    }
    await until(async () => {
      try {
        return (JSON.parse(await readFile(awfTelemetryPendingPath(dir), 'utf8')) as unknown[]).length === 2
      } catch {
        return false
      }
    })
    const pending = JSON.parse(await readFile(awfTelemetryPendingPath(dir), 'utf8')) as Array<{ run_ref: string }>
    expect(pending.map((entry) => entry.run_ref)).toEqual(['run_3', 'run_4'])
  })

  it('summarizeRun：步骤状态与类型映射', () => {
    const summary = summarizeRun(makeRun(), new Map([['say', 'script'], ['review', 'llm']]))
    expect(summary.steps).toEqual([
      { id: 'review', type: 'llm', status: 'failed' },
      { id: 'say', type: 'script', status: 'succeeded' },
    ])
    expect(summary.status).toBe(String(WorkflowStatus.Completed))
  })

  it('attachRunTelemetry：根 run 终态后记录；子 run 不单独记录；detach 后不再观察', async () => {
    const dir = await newTmp()
    await enableTelemetry(dir)
    const { fetchImpl } = recordingFetch(() => ({ status: 200, body: { ok: true, id: 1 } }))
    const controller = createAwfTelemetry({ stateDir: dir, fetchImpl, pollMs: 10 })
    controller.stop()
    const recorded: Run[] = []
    const telemetry = {
      record: (run: Run) => {
        recorded.push(run)
      },
      flush: async () => ({ sent: 0, kept: 0 }),
      stop: (): void => {},
    }
    let currentRun = makeRun()
    const fakePlugin = {
      startRun: async () => currentRun,
      getRun: async () => currentRun,
    } as unknown as import('dsh-plugin-workflow').WorkflowPlugin

    const detach = attachRunTelemetry(fakePlugin, telemetry, { pollMs: 10 })
    await (fakePlugin.startRun as () => Promise<unknown>)()
    await delay(80)
    expect(recorded).toHaveLength(1)
    detach()

    // 子运行：不观察
    currentRun = makeRun({ parentRunId: 'run_parent' })
    const detach2 = attachRunTelemetry(fakePlugin, telemetry, { pollMs: 10 })
    await (fakePlugin.startRun as () => Promise<unknown>)()
    await delay(60)
    expect(recorded).toHaveLength(1)
    detach2()
  })

  it('client.telemetryRun 走 POST /api/telemetry/runs 且带 Bearer', async () => {
    const settings = { ...defaultAwfSettings(), baseUrl: 'http://awf.test', telemetryEnabled: true }
    let authHeader: string | null = null
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      authHeader = (init?.headers as Record<string, string>)?.Authorization ?? null
      return new Response(JSON.stringify({ ok: true, id: 9 }), { status: 200 })
    }) as AwfFetch
    const client = createAwfClient(settings, { fetchImpl, env: { AWF_API_TOKEN: 'tok123' } })
    const out = await client.telemetryRun({
      client: 'desktop',
      workflow_name: 'w',
      run_ref: 'r',
      status: 'completed',
      steps: [],
    })
    expect(out).toEqual({ ok: true, id: 9 })
    expect(authHeader).toBe('Bearer tok123')
  })
})
