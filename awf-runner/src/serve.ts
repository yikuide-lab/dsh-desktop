/**
 * awf-node serve: register this node as an AWF executor and run the
 * claim → execute → result loop against the platform, executing claimed
 * tasks through a local WorkflowPlugin (dsh-plugin-workflow engine) wired
 * with the headless Node LLM hooks.
 *
 * State layout (mirrors the desktop convention where stateDir is
 * `~/.dsh/workflow` and awf.json / awf-executor.json live one level up):
 *   <stateDir>/awf.json            platform connection settings (0600)
 *   <stateDir>/awf-auth.json       optional login session (0600)
 *   <stateDir>/awf-executor.json   executor id + token (0600)
 *   <stateDir>/workflow/           workflow engine state (runs, transcripts)
 */

import { hostname } from 'node:os'
import { join } from 'node:path'
import { WorkflowPlugin } from 'dsh-plugin-workflow'
import type { Run, Step, Workflow } from 'dsh-plugin-workflow/engine'
import { StepType, WorkflowStatus, serializeWorkflow } from 'dsh-plugin-workflow/engine'
import type { AwfFetch } from './awf/client.js'
import {
  normalizeAwfBaseUrl,
  readAwfSettings,
  resolveAwfToken,
  writeAwfSettings,
} from './awf/settings.js'
import { awfAuthAccessToken } from './awf/auth.js'
import type { AwfClaimedTask, AwfExecutorLoopStatus, AwfTaskResult } from './awf/executor.js'
import { createAwfExecutorLoop } from './awf/executor.js'
import type { NodeLlmConfig } from './node/hooks.js'
import { createNodeExecutorHooks, nodeLlmConfigFromEnv } from './node/hooks.js'
import { formatStepOutput } from './node/prompt.js'

export const DEFAULT_CLAIM_WAIT_SEC = 25

export interface ServeOptions {
  /** Node home (see layout above); CLI default: ~/.awf-node or AWF_NODE_STATE_DIR. */
  readonly stateDir: string
  /** Platform base URL override (persisted into awf.json). */
  readonly platform?: string
  /** Env var name holding the platform user token (persisted into awf.json). */
  readonly tokenEnv?: string
  readonly concurrency?: number
  readonly labels?: Record<string, string>
  /** Claim long-poll budget (0..30, default 25). */
  readonly claimWaitSec?: number
  readonly heartbeatMs?: number
  readonly claimIntervalMs?: number
  /** Coordinator tick for the local engine (default 250ms on a node). */
  readonly engineTickMs?: number
  /** Test seams. */
  readonly env?: Record<string, string | undefined>
  readonly fetchImpl?: AwfFetch
  readonly logger?: (message: string) => void
}

export interface ServeHandle {
  stop(): Promise<void>
  status(): AwfExecutorLoopStatus
}

/** Workflow-engine state dir nested inside the node home. */
export function workflowStateDir(stateDir: string): string {
  return join(stateDir, 'workflow')
}

function sanitizeStepId(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return /^[a-z0-9-]+$/.test(value) && value.length <= 63 ? value : 'step-1'
}

/** Map a claimed platform task onto a single-step workflow definition. */
export function claimedTaskWorkflow(task: AwfClaimedTask): { workflow: Workflow; stepId: string } {
  const payload = task.payload
  const rawType = typeof payload.type === 'string' ? payload.type : 'task'
  const stepType = rawType === StepType.Script || rawType === StepType.LLM || rawType === StepType.Task
    ? rawType
    : StepType.Task
  const stepId = sanitizeStepId(task.step_id)

  const step: Step = { id: stepId, type: stepType }
  if (stepType === StepType.Script) {
    if (typeof payload.run === 'string') step.run = payload.run
    if (typeof payload.timeout === 'number' && payload.timeout > 0) step.timeout = payload.timeout
    if (payload.env && typeof payload.env === 'object' && !Array.isArray(payload.env)) {
      const env: Record<string, string> = {}
      for (const [key, value] of Object.entries(payload.env)) {
        if (typeof value === 'string') env[key] = value
      }
      if (Object.keys(env).length > 0) step.env = env
    }
  } else {
    if (typeof payload.prompt === 'string') step.prompt = payload.prompt
    if (typeof payload.role === 'string') step.role = payload.role
    if (typeof payload.model === 'string') step.model = payload.model
    if (payload.inputs && typeof payload.inputs === 'object' && !Array.isArray(payload.inputs)) {
      step.inputs = payload.inputs as Record<string, unknown>
    }
    if (Array.isArray(payload.outputs)) step.outputs = payload.outputs.map(String)
    if (Array.isArray(payload.acceptance)) step.acceptance = payload.acceptance.map(String)
  }

  return {
    stepId,
    workflow: {
      apiVersion: 'workflow-wise/v1',
      kind: 'Workflow',
      metadata: {
        name: `awf-claimed-${task.id}`,
        title: `AWF task #${task.id} (${task.workflow_name})`,
      },
      spec: { steps: [step] },
    },
  }
}

function claimedTaskParams(task: AwfClaimedTask): Record<string, unknown> {
  const payload = task.payload
  const params = (payload.params && typeof payload.params === 'object' && !Array.isArray(payload.params)
    ? { ...payload.params }
    : {}) as Record<string, unknown>
  // A workspace hint drives script-step cwd through the engine's WORKSPACE_ROOT.
  const workspace = typeof params.workspace === 'string' ? params.workspace.trim() : ''
  if (workspace && (workspace.startsWith('/') || /^[A-Za-z]:[\\/]/.test(workspace))) {
    params.workspaceRoot = workspace
  }
  return params
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Execute one claimed task as a synthetic one-step workflow run on the local
 * engine. Returns the honest result (never throws for task-level failures).
 */
export async function runClaimedTask(
  plugin: WorkflowPlugin,
  task: AwfClaimedTask,
  signal: AbortSignal,
): Promise<AwfTaskResult> {
  try {
    if (task.deadline_at) {
      const deadline = Date.parse(task.deadline_at)
      if (Number.isFinite(deadline) && deadline <= Date.now()) {
        return { ok: false, error: `deadline passed (${task.deadline_at})` }
      }
    }
    const { workflow, stepId } = claimedTaskWorkflow(task)
    if (workflow.spec.steps[0]?.type === StepType.Script && !workflow.spec.steps[0].run) {
      return { ok: false, error: 'script task missing payload.run' }
    }
    const yaml = await serializeWorkflow(workflow)
    const { validation } = await plugin.createWorkflow(yaml)
    if (!validation.ok) {
      return { ok: false, error: `synthetic workflow invalid: ${validation.errors.map((e) => e.message).join(', ')}` }
    }
    let run: Run
    try {
      run = await plugin.startRun(workflow.metadata.name, claimedTaskParams(task))
    } catch (error) {
      await plugin.deleteWorkflow(workflow.metadata.name).catch(() => undefined)
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    try {
      while (true) {
        if (signal.aborted) {
          await plugin.stopRun(run.id).catch(() => undefined)
          return { ok: false, error: 'aborted' }
        }
        const latest = await plugin.getRun(run.id)
        if (!latest) return { ok: false, error: `run disappeared: ${run.id}` }
        if (latest.status === WorkflowStatus.Completed) {
          const result = latest.tasks[stepId]?.result
          return { ok: true, output: result === undefined ? '' : formatStepOutput(result) }
        }
        if (latest.status === WorkflowStatus.Failed || latest.status === WorkflowStatus.Aborted) {
          const stepError = latest.tasks[stepId]?.error
          return { ok: false, error: latest.error ?? stepError ?? `run ${latest.status}` }
        }
        await delay(200)
      }
    } finally {
      // The synthetic workflow exists only to carry this task; runs stay for audit.
      await plugin.deleteWorkflow(workflow.metadata.name).catch(() => undefined)
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Start the headless runner: persist connection overrides, wire the engine
 * with the Node LLM hooks, and start the executor loop. Resolves once the
 * loop is started; the returned handle stops everything gracefully.
 */
export async function serve(options: ServeOptions): Promise<ServeHandle> {
  const log = options.logger ?? ((message: string): void => console.log(`[awf-node] ${message}`))
  const env = options.env ?? process.env
  const stateDir = options.stateDir
  const wfStateDir = workflowStateDir(stateDir)

  const current = await readAwfSettings(wfStateDir)
  const merged = {
    ...current,
    ...(options.platform ? { baseUrl: normalizeAwfBaseUrl(options.platform) } : {}),
    ...(options.tokenEnv ? { apiTokenEnv: options.tokenEnv } : {}),
  }
  if (merged.baseUrl !== current.baseUrl || merged.apiTokenEnv !== current.apiTokenEnv) {
    await writeAwfSettings(wfStateDir, merged)
  }

  const llmConfig: NodeLlmConfig | null = nodeLlmConfigFromEnv(env)
  const hooks = createNodeExecutorHooks(llmConfig, options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
  if (llmConfig) {
    log(`LLM endpoint: ${llmConfig.baseUrl} (model ${llmConfig.model})`)
  } else {
    log(`llm/task steps disabled: set AWF_NODE_LLM_BASE_URL and AWF_NODE_LLM_MODEL to enable`)
  }

  const plugin = new WorkflowPlugin({
    stateDir: wfStateDir,
    mcpEnabled: false,
    triggersEnabled: false,
    ...(options.engineTickMs !== undefined ? { tickInterval: options.engineTickMs } : { tickInterval: 250 }),
  })
  plugin.setHostHooks(hooks)
  await plugin.init()

  const authOptions = {
    stateDir: wfStateDir,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    env,
  }
  const loop = createAwfExecutorLoop({
    stateDir: wfStateDir,
    log,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    env,
    ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
    ...(options.claimIntervalMs !== undefined ? { claimIntervalMs: options.claimIntervalMs } : {}),
    claimWaitSec: options.claimWaitSec ?? DEFAULT_CLAIM_WAIT_SEC,
    concurrency: options.concurrency ?? 1,
    registerName: `awf-node@${hostname()}`,
    capabilities: { task: true, script: true, llm: llmConfig !== null },
    ...(options.labels ? { labels: options.labels } : {}),
    // Token chain: env var > saved token > login session (auto-refresh).
    resolveUserToken: async (settings) => {
      const staticToken = resolveAwfToken(settings, env)
      if (staticToken) return staticToken
      return awfAuthAccessToken(authOptions)
    },
    runTask: (task, signal) => runClaimedTask(plugin, task, signal),
  })
  loop.start()

  log(`serving ${merged.baseUrl} as ${`awf-node@${hostname()}`} (state: ${stateDir})`)
  return {
    async stop() {
      await loop.stop()
      plugin.stop()
      await plugin.whenStopped()
    },
    status: () => loop.status(),
  }
}
