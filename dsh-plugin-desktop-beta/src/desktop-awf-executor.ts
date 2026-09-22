/**
 * Opt-in desktop executor for the AWF platform (awf-a3c S-P4 PoC).
 *
 * The register → claim → result loop and heartbeat machinery live in the
 * shared pure-Node `awf-runner` package (also used by the headless awf-node
 * runner). This adapter keeps the desktop-specific parts: the
 * settings.executorEnabled gate, registration identity, and task execution
 * through the Host's real agent path when available; without the agents
 * service the task fails honestly instead of pretending.
 */

import { homedir } from 'node:os'
import type { ExecutionContext, Step, Workflow } from 'dsh-plugin-workflow/engine'
import type { AwfFetch } from './desktop-awf-client.ts'
import {
  createAwfExecutorLoop,
  type AwfClaimedTask,
  type AwfTaskResult,
} from 'awf-runner/awf-executor'
import { readAwfSettings } from './desktop-awf-settings.ts'
import type { DesktopWorkflowHostServices } from './desktop-workflow-executor.ts'

export { awfExecutorCredentialsPath } from 'awf-runner/awf-executor'

export interface AwfExecutorOptions {
  readonly stateDir: string
  readonly log?: (message: string) => void
  /** Test seams: inject fetch / env without touching globals. */
  readonly fetchImpl?: AwfFetch
  readonly env?: Record<string, string | undefined>
  /** Host LLM/agents services (available once the llm service is injected). */
  readonly getHostServices?: () => DesktopWorkflowHostServices | undefined
  readonly heartbeatMs?: number
  readonly claimIntervalMs?: number
}

export interface AwfExecutorStatus {
  readonly running: boolean
  readonly registered: boolean
  readonly executorId: number | null
  readonly executingTaskId: number | null
  readonly lastClaimAt: string | null
  readonly lastError: string | null
}

export interface AwfExecutorController {
  /** 启动心跳/认领循环（仅在 settings.executorEnabled=true 时生效）。 */
  start(): void
  stop(): Promise<void>
  status(): AwfExecutorStatus
}

/** Execute a claimed task through the Host agent path (honest failure without it). */
async function executeDesktopTask(
  options: AwfExecutorOptions,
  task: AwfClaimedTask,
  signal: AbortSignal,
): Promise<AwfTaskResult> {
  try {
    const services = options.getHostServices?.()
    if (!services?.agents) {
      return { ok: false, error: '桌面执行器不可用：缺少 Host agents 服务' }
    }
    const { runTaskStep } = await import('./desktop-workflow-executor.ts')
    const step = {
      id: task.step_id,
      type: 'task',
      prompt: typeof task.payload.prompt === 'string' ? task.payload.prompt : '',
      inputs: task.payload.inputs,
      outputs: Array.isArray(task.payload.outputs) ? task.payload.outputs : undefined,
      acceptance: Array.isArray(task.payload.acceptance) ? task.payload.acceptance : undefined,
      role: typeof task.payload.role === 'string' ? task.payload.role : undefined,
    } as unknown as Step
    const params = (task.payload.params && typeof task.payload.params === 'object'
      ? task.payload.params
      : {}) as Record<string, unknown>
    const cwd = typeof params.workspace === 'string' && params.workspace.trim()
      ? params.workspace.trim()
      : homedir()
    const context: ExecutionContext = {
      runId: `awf-task-${task.id}`,
      workflow: {
        apiVersion: 'workflow-wise/v1',
        kind: 'Workflow',
        metadata: { name: task.workflow_name },
        spec: { steps: [] },
      } as unknown as Workflow,
      stateDir: options.stateDir,
      params,
    }
    const outcome = await runTaskStep(services, step, context, cwd, signal)
    return outcome.ok
      ? { ok: true, output: typeof outcome.output === 'string' ? outcome.output : JSON.stringify(outcome.output) }
      : { ok: false, error: outcome.error ?? 'executor task failed' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function createAwfExecutor(options: AwfExecutorOptions): AwfExecutorController {
  const loop = createAwfExecutorLoop({
    stateDir: options.stateDir,
    ...(options.log ? { log: options.log } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.env ? { env: options.env } : {}),
    ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
    ...(options.claimIntervalMs !== undefined ? { claimIntervalMs: options.claimIntervalMs } : {}),
    registerName: 'dsh-desktop',
    capabilities: { task: true },
    isEnabled: async () => (await readAwfSettings(options.stateDir)).executorEnabled,
    runTask: (task, signal) => executeDesktopTask(options, task, signal),
  })
  return {
    start: () => loop.start(),
    stop: () => loop.stop(),
    status: () => {
      const status = loop.status()
      return {
        running: status.running,
        registered: status.registered,
        executorId: status.executorId,
        executingTaskId: status.executingTaskId,
        lastClaimAt: status.lastClaimAt,
        lastError: status.lastError,
      }
    },
  }
}
