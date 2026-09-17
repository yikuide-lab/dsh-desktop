/**
 * Opt-in run-summary telemetry for the AWF platform (awf-a3c C-P4 通道⑤).
 *
 * 默认关闭：关闭时既不产生任何出站请求，也不落盘任何摘要。
 * 开启后，本地 run 到达终态时上报摘要（工作流名/步骤状态/token 估算/耗时）；
 * 平台不可达时摘要进入本地 0600 待发队列（有界），连接恢复后择机补发。
 * 摘要绝不包含 prompt 与输出内容。
 */

import type { Run, Task } from 'dsh-plugin-workflow/engine'
import { TaskStatus, WorkflowStatus } from 'dsh-plugin-workflow/engine'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { WorkflowPlugin } from 'dsh-plugin-workflow'
import { createAwfClient, type AwfTelemetrySummary } from './desktop-awf-client.ts'
import { readAwfSettings } from './desktop-awf-settings.ts'

export interface AwfTelemetryOptions {
  readonly stateDir: string
  readonly log?: (message: string) => void
  /** Test seams: inject fetch / env without touching globals. */
  readonly fetchImpl?: typeof fetch
  readonly env?: Record<string, string | undefined>
  /** 待发队列上限（超出丢弃最旧摘要）。 */
  readonly maxPending?: number
  /** run 终态轮询间隔（attachRunTelemetry 用）。 */
  readonly pollMs?: number
  /** 可选：查询 run 各步骤的真实类型（默认全部记作 task）。 */
  readonly lookupStepTypes?: (run: Run) => Promise<ReadonlyMap<string, string>>
}

export interface AwfTelemetryController {
  /** 记录一次终态 run（内部异步，绝不抛出、不阻塞 run 路径）。 */
  record(run: Run): void
  /** 立即尝试补发待发摘要（连接检查成功后调用）。 */
  flush(): Promise<{ sent: number; kept: number }>
  /** 释放内部轮询计时器。 */
  stop(): void
}

/** 本地待发队列文件（0600，与 awf.json 同目录）。 */
export function awfTelemetryPendingPath(stateDir: string): string {
  return join(stateDir, '..', 'awf-telemetry-pending.json')
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  WorkflowStatus.Completed,
  WorkflowStatus.Failed,
  WorkflowStatus.Aborted,
].map((value) => String(value)))

function taskStepStatus(task: Task | undefined): string {
  if (!task) return 'skipped'
  switch (task.status) {
    case TaskStatus.Completed:
      return 'succeeded'
    case TaskStatus.Failed:
      return 'failed'
    case TaskStatus.Skipped:
      return 'skipped'
    default:
      return 'pending'
  }
}

/** 从终态 Run 构造摘要视图（仅元数据，无 prompt/输出）。 */
export function summarizeRun(
  run: Run,
  stepTypes: ReadonlyMap<string, string> = new Map(),
): AwfTelemetrySummary {
  const tasks = run.tasks ?? {}
  const steps = Object.values(tasks)
    .map((task) => ({
      id: task.stepId,
      type: stepTypes.get(task.stepId) ?? 'task',
      status: taskStepStatus(task),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const durationMs = run.completedAt && run.startedAt
    ? Math.max(0, new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime())
    : undefined
  return {
    client: 'desktop',
    workflow_name: run.workflowName,
    run_ref: run.id,
    status: String(run.status),
    steps,
    ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
    ...(run.completedAt ? { finished_at: run.completedAt } : {}),
  }
}

export function createAwfTelemetry(options: AwfTelemetryOptions): AwfTelemetryController {
  const log = options.log ?? ((): void => {})
  const maxPending = options.maxPending ?? 200
  const stopped = { value: false }

  async function readPending(): Promise<AwfTelemetrySummary[]> {
    try {
      const raw = await readFile(awfTelemetryPendingPath(options.stateDir), 'utf8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as AwfTelemetrySummary[]) : []
    } catch {
      return []
    }
  }

  async function writePending(entries: AwfTelemetrySummary[]): Promise<void> {
    const path = awfTelemetryPendingPath(options.stateDir)
    if (entries.length === 0) {
      // 队列清空即删除文件，不在磁盘上留空壳
      await rm(path, { force: true })
      return
    }
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(entries, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  }

  async function recordInner(run: Run): Promise<void> {
    const settings = await readAwfSettings(options.stateDir)
    if (!settings.telemetryEnabled) return
    const stepTypes = options.lookupStepTypes ? await options.lookupStepTypes(run) : undefined
    const summary = summarizeRun(run, stepTypes)
    const pending = await readPending()
    pending.push(summary)
    while (pending.length > maxPending) pending.shift()
    await writePending(pending)
    log(`AWF telemetry: summary queued for ${run.workflowName} (${pending.length} pending)`)
    await flushInner()
  }

  async function flushInner(): Promise<{ sent: number; kept: number }> {
    const pending = await readPending()
    if (pending.length === 0) return { sent: 0, kept: 0 }
    const settings = await readAwfSettings(options.stateDir)
    if (!settings.telemetryEnabled) return { sent: 0, kept: pending.length }
    const client = createAwfClient(settings, {
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.env ? { env: options.env } : {}),
    })
    let sent = 0
    try {
      for (const summary of pending) {
        await client.telemetryRun(summary)
        sent += 1
      }
    } catch {
      // 逐条上报中断即停止；剩余条目留在队列等待下次补发
    }
    const kept = pending.slice(sent)
    await writePending(kept)
    if (sent > 0) log(`AWF telemetry: ${sent} sent, ${kept.length} kept pending`)
    return { sent, kept: kept.length }
  }

  return {
    record(run) {
      void recordInner(run).catch((error) => {
        log(`AWF telemetry: record failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    },
    flush: flushInner,
    stop() {
      stopped.value = true
    },
  }
}

/**
 * 观察插件的 run 生命周期：包装 startRun，对每个根 run 轮询至终态后记录摘要。
 * 子运行（sub_workflow）并入父 run 摘要，不单独上报。返回解绑函数。
 */
export function attachRunTelemetry(
  plugin: WorkflowPlugin,
  telemetry: AwfTelemetryController,
  options: { pollMs?: number } = {},
): () => void {
  const pollMs = options.pollMs ?? 2_000
  type StartRunFn = (...args: unknown[]) => Promise<Run>
  const target = plugin as unknown as { startRun: StartRunFn }
  const original: StartRunFn = target.startRun.bind(plugin)

  const wrapped: StartRunFn = async (...args) => {
    const run = await original(...args)
    if (!run.parentRunId) {
      void watchRun(plugin, run.id, telemetry, pollMs)
    }
    return run
  }
  target.startRun = wrapped
  return () => {
    target.startRun = original
  }
}

async function watchRun(
  plugin: WorkflowPlugin,
  runId: string,
  telemetry: AwfTelemetryController,
  pollMs: number,
): Promise<void> {
  // 终态轮询上限 24h（防泄漏）；stop 后由调用方丢弃 controller 即可
  const deadline = Date.now() + 24 * 60 * 60 * 1000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs))
    let run: Run | null = null
    try {
      run = await plugin.getRun(runId)
    } catch {
      return
    }
    if (!run) return
    if (TERMINAL_STATUSES.has(String(run.status))) {
      telemetry.record(run)
      return
    }
  }
}
