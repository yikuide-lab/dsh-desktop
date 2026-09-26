/**
 * DSH Workflow Plugin
 * Integrates workflow engine as a Cordis plugin for DSH Desktop
 */

import { join } from 'node:path'
import { homedir } from 'node:os'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { WorkflowStore } from './engine/store.js'
import { Coordinator } from './engine/coordinator.js'
import { createDesktopExecutor, type DesktopExecutorHooks, type StepOutcome } from './engine/executor.js'
import { TriggerManager, type TriggerConfig, type TriggerRecord } from './triggers/trigger.js'
import { MCPServer } from './mcp/server.js'
import { listBuiltinTemplates, type WorkflowTemplateDefinition } from './templates.js'
import {
  allocateUserTemplateId,
  loadUserTemplates,
  removeUserTemplate,
  writeUserTemplate,
  type UserTemplateRecord,
} from './user-templates.js'
import {
  parseWorkflow,
  validateWorkflow,
  serializeWorkflow,
  WorkflowStatus,
  TaskStatus,
  StepType,
  DispatchStatus,
  RUN_SCHEMA_VERSION,
} from './engine/models.js'
import {
  isGatePass,
  markAborted,
  isRunComplete,
  resolveGate,
  resolveCollabJoinGate,
} from './engine/engine.js'
import { truncateTranscriptText, type TranscriptEvent } from './engine/transcript.js'
import type { ScriptPolicy } from './engine/script-policy.js'
import type { RsiReviewRequest, RsiReviewResult } from './engine/rsi-review.js'
import {
  buildWorkflowStatsDetail,
  buildWorkflowStatsSummaries,
  summarizeWorkflowRuns,
  type WorkflowStatsDetail,
  type WorkflowStatsSummary,
} from './engine/workflow-stats.js'
import type {
  Workflow,
  Run,
  Executor,
  Gate,
  Step,
  ExecutionContext,
} from './engine/models.js'

export interface WorkflowPluginConfig {
  stateDir?: string
  maxConcurrency?: number
  /** Maximum concurrently live workflow runs (including nested sub_workflow runs). */
  maxActiveRuns?: number
  /** Maximum sub_workflow nesting depth (root = 1). */
  maxNestedDepth?: number
  tickInterval?: number
  /** Fail in-flight dispatches past per-step timeout / stall ceiling (ms). */
  heartbeatTimeout?: number
  mcpEnabled?: boolean
  /** When true, expose destructive MCP tools (delete, stop, resolve with tokens). */
  mcpDangerousToolsEnabled?: boolean
  triggersEnabled?: boolean
  /** Script execution policy (default allow with cwd jail when WORKSPACE_ROOT set). */
  scriptPolicy?: 'allow' | 'deny' | 'workspace-only'
  /** Keep at most this many finished runs (0 = unlimited). */
  maxRetainedRuns?: number
  /** Delete finished runs older than this many days (0 = unlimited). */
  maxRunAgeDays?: number
}

/** Internal params key tracking workflow names already on the call stack. */
export const WORKFLOW_STACK_PARAM = '__workflowStack'

export interface StartRunOptions {
  parentRunId?: string
  rootRunId?: string
}

export interface WorkspaceBinding {
  workspaceId: string
  workflowName: string
  updatedAt: string
}

/** Preferred LLM route for workflow steps by capability bias. */
export interface WorkflowLlmProviderPref {
  id: string
  /** Fully-qualified `provider/model` route. */
  model: string
  /** Capability tags such as coding, review, security, router. */
  bias: string[]
}

/** Persisted workflow LLM preference document. */
export interface WorkflowSettings {
  providers: WorkflowLlmProviderPref[]
  defaultBias: string
  /** Extra attempts after the first step failure. */
  defaultRetries: number
  /** Applied when a step omits on_failure. */
  defaultOnFailure: 'fail' | 'skip' | 'compensate'
  /** Optional retention overrides (0 = unlimited). */
  maxRetainedRuns?: number
  maxRunAgeDays?: number
  /** Script execution policy override. */
  scriptPolicy?: 'allow' | 'deny' | 'workspace-only'
}

export function defaultWorkflowSettings(): WorkflowSettings {
  return {
    providers: [],
    defaultBias: 'coding',
    defaultRetries: 2,
    defaultOnFailure: 'fail',
    maxRetainedRuns: 200,
    maxRunAgeDays: 30,
    scriptPolicy: 'allow',
  }
}

function normalizeOnFailure(value: unknown): 'fail' | 'skip' | 'compensate' {
  if (value === 'skip' || value === 'compensate' || value === 'fail') return value
  return 'fail'
}

function normalizeRetries(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  return 2
}

function normalizeNonNegInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  return fallback
}

function normalizeScriptPolicy(
  value: unknown,
  fallback: ScriptPolicy,
): ScriptPolicy {
  if (value === 'allow' || value === 'deny' || value === 'workspace-only') return value
  return fallback
}

function summarizeTranscriptOutput(output: unknown): unknown {
  if (output == null) return output
  if (typeof output === 'string') return truncateTranscriptText(output)
  if (typeof output !== 'object') return output
  try {
    const raw = JSON.stringify(output)
    if (raw.length <= 16_000) return output
    return { truncated: true, preview: truncateTranscriptText(raw) }
  } catch {
    return String(output)
  }
}

/** True when a running run only waits on unresolved gates (no in-flight work). */
export function isWaitingOnlyOnGates(run: Run): boolean {
  const unresolved = Object.values(run.gates).some((gate) => !gate.resolved)
  if (!unresolved) return false
  for (const task of Object.values(run.tasks)) {
    for (const dispatch of task.dispatches) {
      if (
        dispatch.status === DispatchStatus.Queued
        || dispatch.status === DispatchStatus.Running
      ) {
        return false
      }
    }
  }
  return true
}

export interface PendingGateView {
  runId: string
  stepId: string
  question: string
  options: string[]
  pass?: string[]
  token: string
}

export class WorkflowPlugin {
  private store: WorkflowStore
  private coordinators = new Map<string, Coordinator>()
  private persistQueues = new Map<string, Promise<void>>()
  private triggerManager: TriggerManager
  private mcpServer: MCPServer | null = null
  private config: Required<WorkflowPluginConfig>
  private executor!: Executor
  private hostHooks: DesktopExecutorHooks = {}
  private bindingsPath: string
  private settingsPath: string
  private triggersPath: string
  private settings: WorkflowSettings = defaultWorkflowSettings()
  private userTemplates: UserTemplateRecord[] = []

  constructor(config: WorkflowPluginConfig = {}) {
    this.config = {
      stateDir: config.stateDir ?? join(homedir(), '.dsh', 'workflow'),
      maxConcurrency: config.maxConcurrency ?? 4,
      maxActiveRuns: config.maxActiveRuns ?? 4,
      maxNestedDepth: config.maxNestedDepth ?? 3,
      tickInterval: config.tickInterval ?? 1000,
      heartbeatTimeout: config.heartbeatTimeout ?? 900_000,
      mcpEnabled: config.mcpEnabled ?? true,
      mcpDangerousToolsEnabled: config.mcpDangerousToolsEnabled ?? false,
      triggersEnabled: config.triggersEnabled ?? false,
      scriptPolicy: config.scriptPolicy ?? 'allow',
      maxRetainedRuns: config.maxRetainedRuns ?? 200,
      maxRunAgeDays: config.maxRunAgeDays ?? 30,
    }

    this.store = new WorkflowStore(this.config.stateDir)
    this.triggerManager = new TriggerManager((triggerConfig) => {
      void this.handleTrigger(triggerConfig)
    })
    this.bindingsPath = join(this.config.stateDir, 'bindings.json')
    this.settingsPath = join(this.config.stateDir, 'settings.json')
    this.triggersPath = join(this.config.stateDir, 'triggers.json')
    this.rebuildExecutor()
  }

  /** Replace Host LLM/task hooks while keeping nested sub_workflow wired. */
  setHostHooks(hooks: DesktopExecutorHooks = {}): void {
    const { runSubWorkflow: _ignored, ...rest } = hooks
    this.hostHooks = rest
    this.rebuildExecutor()
  }

  /** Replace the step executor used by new runs (advanced; prefer setHostHooks). */
  setExecutor(executor: Executor): void {
    this.executor = executor
  }

  private rebuildExecutor(): void {
    const hostHooks = this.hostHooks
    this.executor = createDesktopExecutor({
      scriptPolicy: (this.settings.scriptPolicy ?? this.config.scriptPolicy) as ScriptPolicy,
      hooks: {
        runLlm: hostHooks.runLlm
          ? async (step, context, cwd, signal) => {
            await this.safeTranscript(context.runId, {
              type: 'llm.request',
              stepId: step.id,
              data: {
                role: step.role,
                model: step.model,
                prompt: truncateTranscriptText(step.prompt ?? ''),
                cwd,
              },
            })
            const outcome = await hostHooks.runLlm!(step, context, cwd, signal)
            await this.safeTranscript(context.runId, {
              type: 'llm.response',
              stepId: step.id,
              data: {
                ok: outcome.ok,
                error: outcome.error,
                output: summarizeTranscriptOutput(outcome.output),
              },
            })
            return outcome
          }
          : undefined,
        runTask: hostHooks.runTask
          ? async (step, context, cwd, signal) => {
            await this.safeTranscript(context.runId, {
              type: 'task.request',
              stepId: step.id,
              data: {
                role: step.role,
                model: step.model,
                inputs: step.inputs,
                cwd,
              },
            })
            const outcome = await hostHooks.runTask!(step, context, cwd, signal)
            await this.safeTranscript(context.runId, {
              type: 'task.response',
              stepId: step.id,
              data: {
                ok: outcome.ok,
                error: outcome.error,
                output: summarizeTranscriptOutput(outcome.output),
              },
            })
            return outcome
          }
          : undefined,
        runSubWorkflow: (step, context, signal) => this.executeSubWorkflow(step, context, signal),
      },
    })
  }

  private async safeTranscript(
    runId: string,
    event: Omit<TranscriptEvent, 'ts'> & { ts?: string },
  ): Promise<void> {
    try {
      await this.store.appendTranscript(runId, event)
    } catch (error) {
      console.error('[workflow] transcript append failed:', error)
    }
  }

  private schedulePersist(runId: string): void {
    const previous = this.persistQueues.get(runId) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const live = this.getLiveCoordinator(runId)?.getRun()
        if (live) {
          await this.store.saveRun(live)
          return
        }
      })
    this.persistQueues.set(runId, next)
    void next.finally(() => {
      if (this.persistQueues.get(runId) === next) this.persistQueues.delete(runId)
    })
  }

  private createCoordinator(): Coordinator {
    const coordinator = new Coordinator({
      maxConcurrency: this.config.maxConcurrency,
      tickInterval: this.config.tickInterval,
      heartbeatTimeout: this.config.heartbeatTimeout,
      failurePolicy: {
        defaultRetries: this.settings.defaultRetries,
        defaultOnFailure: this.settings.defaultOnFailure,
      },
    })
    coordinator.on('task:dispatch', (stepId: string, dispatchId: string) => {
      const run = coordinator.getRun()
      if (!run) return
      void this.safeTranscript(run.id, {
        type: 'dispatch.submit',
        stepId,
        dispatchId,
      })
      this.schedulePersist(run.id)
    })
    coordinator.on('task:settle', (stepId: string, dispatchId: string, result: { success: boolean; output?: unknown; error?: string }) => {
      const run = coordinator.getRun()
      if (!run) return
      void this.safeTranscript(run.id, {
        type: 'dispatch.settle',
        stepId,
        dispatchId,
        data: {
          success: result.success,
          error: result.error,
          output: summarizeTranscriptOutput(result.output),
        },
      })
      this.schedulePersist(run.id)
    })
    coordinator.on('run:complete', (run: Run) => {
      void this.safeTranscript(run.id, { type: 'run.complete' })
      const persist = (this.persistQueues.get(run.id) ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => this.store.saveRun(run))
      this.persistQueues.set(run.id, persist)
      void persist.finally(() => {
        this.detachCoordinator(run.id)
        if (this.persistQueues.get(run.id) === persist) this.persistQueues.delete(run.id)
      })
    })
    coordinator.on('run:fail', (run: Run) => {
      void this.safeTranscript(run.id, {
        type: 'run.fail',
        data: { error: run.error },
      })
      const persist = (this.persistQueues.get(run.id) ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => this.store.saveRun(run))
      this.persistQueues.set(run.id, persist)
      void persist.finally(() => {
        this.detachCoordinator(run.id)
        if (this.persistQueues.get(run.id) === persist) this.persistQueues.delete(run.id)
      })
    })
    return coordinator
  }

  private detachCoordinator(runId: string): void {
    const coordinator = this.coordinators.get(runId)
    if (!coordinator) return
    coordinator.stop()
    this.coordinators.delete(runId)
  }

  private countActiveRuns(): number {
    let count = 0
    for (const coordinator of this.coordinators.values()) {
      if (coordinator.getRun()?.status === WorkflowStatus.Running) count += 1
    }
    return count
  }

  private listLiveRuns(): Run[] {
    const runs: Run[] = []
    for (const coordinator of this.coordinators.values()) {
      const run = coordinator.getRun()
      if (run) runs.push(run)
    }
    return runs
  }

  private getLiveCoordinator(runId: string): Coordinator | undefined {
    return this.coordinators.get(runId)
  }

  async init(): Promise<void> {
    await this.store.init()
    await mkdir(this.config.stateDir, { recursive: true })
    this.settings = await this.readSettings()
    this.userTemplates = await loadUserTemplates(this.config.stateDir)
    await this.recoverOrphanRuns()
    if (this.config.triggersEnabled) {
      await this.loadPersistedTriggers()
    }
    await this.purgeRuns({ quiet: true }).catch((error) => {
      console.error('[workflow] retention purge on init failed:', error)
    })

    if (this.config.mcpEnabled) {
      this.mcpServer = new MCPServer(this)
      console.log('[workflow] MCP server ready (stdio mode)')
    }

    console.log(`[workflow] Initialized with state dir: ${this.config.stateDir}`)
  }

  /** Fail-closed: mark disk runs still "running" as aborted after process restart,
   * unless they are only waiting on unresolved gates with no in-flight dispatches. */
  private async recoverOrphanRuns(): Promise<void> {
    const runs = await this.store.listRuns()
    for (const run of runs) {
      if (run.status !== WorkflowStatus.Running) continue
      if (isWaitingOnlyOnGates(run)) {
        await this.safeTranscript(run.id, {
          type: 'run.orphan',
          data: { preserved: true, reason: 'waiting on unresolved gate' },
        })
        continue
      }
      const updated = markAborted(run, 'orphan after process restart')
      await this.store.saveRun(updated)
      await this.safeTranscript(run.id, {
        type: 'run.orphan',
        data: { reason: 'orphan after process restart' },
      })
    }
  }

  async startMCP(): Promise<void> {
    if (this.mcpServer) {
      await this.mcpServer.startStdio()
    }
  }

  async createWorkflow(yaml: string): Promise<{ workflow: Workflow; validation: ReturnType<typeof validateWorkflow> }> {
    const workflow = await parseWorkflow(yaml)
    const validation = validateWorkflow(workflow)

    if (validation.ok) {
      const state = await this.store.saveWorkflow(workflow)
      return { workflow: state.workflow, validation }
    }

    return { workflow, validation }
  }

  async validateYaml(yaml: string): Promise<ReturnType<typeof validateWorkflow>> {
    const workflow = await parseWorkflow(yaml)
    return validateWorkflow(workflow)
  }

  async getWorkflow(name: string): Promise<Workflow | null> {
    const state = await this.store.loadWorkflow(name)
    return state?.workflow ?? null
  }

  async listWorkflows(): Promise<Workflow[]> {
    const states = await this.store.listWorkflows()
    return states.map(s => s.workflow)
  }

  async deleteWorkflow(name: string): Promise<boolean> {
    return this.store.deleteWorkflow(name)
  }

  async exportWorkflowYaml(name: string): Promise<string | null> {
    const workflow = await this.getWorkflow(name)
    if (!workflow) return null
    return serializeWorkflow(workflow)
  }

  /** Parse YAML then dump with Host js-yaml (canonical round-trip). */
  async canonicalizeYaml(yaml: string): Promise<string> {
    const workflow = await parseWorkflow(yaml)
    return serializeWorkflow(workflow)
  }

  listTemplates(): WorkflowTemplateDefinition[] {
    return [
      ...listBuiltinTemplates().map((template) => ({ ...template, builtin: true as const })),
      ...this.userTemplates,
    ]
  }

  /**
   * Persist a user template (import or promote-from-workflow).
   * Built-in ids cannot be overwritten.
   */
  async saveUserTemplate(input: {
    yaml: string
    name?: string
    description?: string
    category?: WorkflowTemplateDefinition['category']
    id?: string
    sourceWorkflowName?: string
  }): Promise<UserTemplateRecord> {
    const workflow = await parseWorkflow(input.yaml)
    const validation = validateWorkflow(workflow)
    if (!validation.ok) {
      throw new Error(`Template validation failed: ${validation.errors.map((e) => e.message).join(', ')}`)
    }
    const yaml = await serializeWorkflow(workflow)
    const preferredId = input.id?.trim()
      || workflow.metadata.name
      || input.name?.trim()
      || 'user-template'
    const builtinIds = new Set(listBuiltinTemplates().map((entry) => entry.id))
    if (input.id && builtinIds.has(input.id)) {
      throw new Error(`Cannot overwrite built-in template: ${input.id}`)
    }
    const updating = input.id
      ? this.userTemplates.find((entry) => entry.id === input.id)
      : undefined
    const finalId = updating
      ? updating.id
      : allocateUserTemplateId(preferredId, [
        ...builtinIds,
        ...this.userTemplates.map((entry) => entry.id),
      ])

    const record: UserTemplateRecord = {
      id: finalId,
      name: (input.name?.trim() || workflow.metadata.title || workflow.metadata.name || finalId).trim(),
      description: input.description?.trim()
        || workflow.metadata.description
        || '',
      category: input.category ?? 'custom',
      yaml,
      builtin: false,
      updatedAt: new Date().toISOString(),
      ...(input.sourceWorkflowName?.trim()
        ? { sourceWorkflowName: input.sourceWorkflowName.trim() }
        : {}),
    }
    await writeUserTemplate(this.config.stateDir, record)
    this.userTemplates = [
      ...this.userTemplates.filter((entry) => entry.id !== record.id),
      record,
    ].sort((a, b) => a.name.localeCompare(b.name))
    return record
  }

  /** Delete a user-saved template. Built-ins cannot be removed. */
  async deleteUserTemplate(id: string): Promise<boolean> {
    if (listBuiltinTemplates().some((entry) => entry.id === id)) {
      throw new Error(`Cannot delete built-in template: ${id}`)
    }
    const removed = await removeUserTemplate(this.config.stateDir, id)
    if (removed) {
      this.userTemplates = this.userTemplates.filter((entry) => entry.id !== id)
    }
    return removed
  }

  /**
   * Promote a saved workflow into the user template catalog.
   * Does not delete or alter the original workflow.
   */
  async promoteWorkflowToTemplate(workflowName: string, options?: {
    name?: string
    description?: string
    category?: WorkflowTemplateDefinition['category']
    id?: string
  }): Promise<UserTemplateRecord> {
    const yaml = await this.exportWorkflowYaml(workflowName)
    if (!yaml) throw new Error(`Workflow not found: ${workflowName}`)
    const workflow = await this.getWorkflow(workflowName)
    return this.saveUserTemplate({
      yaml,
      name: options?.name ?? workflow?.metadata.title ?? workflowName,
      description: options?.description ?? workflow?.metadata.description ?? '',
      category: options?.category ?? 'custom',
      ...(options?.id ? { id: options.id } : {}),
      sourceWorkflowName: workflowName,
    })
  }

  /** Synchronous cached settings for Host executor routing. */
  getSettingsSync(): WorkflowSettings {
    return this.settings
  }

  async getSettings(): Promise<WorkflowSettings> {
    this.settings = await this.readSettings()
    return this.settings
  }

  async setSettings(settings: WorkflowSettings): Promise<WorkflowSettings> {
    const normalized: WorkflowSettings = {
      defaultBias: typeof settings.defaultBias === 'string' && settings.defaultBias.trim()
        ? settings.defaultBias.trim()
        : 'coding',
      defaultRetries: normalizeRetries(settings.defaultRetries),
      defaultOnFailure: normalizeOnFailure(settings.defaultOnFailure),
      maxRetainedRuns: normalizeNonNegInt(settings.maxRetainedRuns, this.config.maxRetainedRuns),
      maxRunAgeDays: normalizeNonNegInt(settings.maxRunAgeDays, this.config.maxRunAgeDays),
      scriptPolicy: normalizeScriptPolicy(settings.scriptPolicy, this.config.scriptPolicy),
      providers: Array.isArray(settings.providers)
        ? settings.providers
          .filter((entry): entry is WorkflowLlmProviderPref => (
            !!entry
            && typeof entry.id === 'string'
            && typeof entry.model === 'string'
            && entry.model.includes('/')
            && Array.isArray(entry.bias)
          ))
          .map((entry) => ({
            id: entry.id.trim(),
            model: entry.model.trim(),
            bias: entry.bias.map((item) => String(item).trim()).filter(Boolean),
          }))
        : [],
    }
    await mkdir(this.config.stateDir, { recursive: true })
    await writeFile(this.settingsPath, JSON.stringify(normalized, null, 2), 'utf8')
    this.settings = normalized
    this.rebuildExecutor()
    for (const coordinator of this.coordinators.values()) {
      coordinator.setFailurePolicy({
        defaultRetries: normalized.defaultRetries,
        defaultOnFailure: normalized.defaultOnFailure,
      })
    }
    await this.purgeRuns({ quiet: true }).catch(() => undefined)
    return normalized
  }

  async startRun(
    workflowName: string,
    params?: Record<string, unknown>,
    options: StartRunOptions = {},
  ): Promise<Run> {
    const workflow = await this.getWorkflow(workflowName)
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowName}`)
    }

    const validation = validateWorkflow(workflow)
    if (!validation.ok) {
      throw new Error(`Workflow validation failed: ${validation.errors.map(e => e.message).join(', ')}`)
    }

    if (this.countActiveRuns() >= this.config.maxActiveRuns) {
      throw new Error(
        `Maximum active runs (${this.config.maxActiveRuns}) reached. Stop a running workflow before starting another.`,
      )
    }

    const coordinator = this.createCoordinator()
    const run = await coordinator.init(workflow, this.executor, params, {
      parentRunId: options.parentRunId,
      rootRunId: options.rootRunId ?? options.parentRunId,
      coordinatorId: `coord-${workflowName}`,
    })
    this.coordinators.set(run.id, coordinator)
    await this.store.saveRun(run)
    await this.safeTranscript(run.id, {
      type: 'run.start',
      data: {
        workflowName,
        parentRunId: options.parentRunId,
        rootRunId: options.rootRunId ?? options.parentRunId,
        params: run.params,
      },
    })
    coordinator.start()
    return run
  }

  async getRun(runId: string): Promise<Run | null> {
    const live = this.getLiveCoordinator(runId)?.getRun()
    if (live) return live
    return this.store.loadRun(runId)
  }

  async listRuns(workflowName?: string): Promise<Run[]> {
    const stored = await this.store.listRuns(workflowName)
    const live = this.listLiveRuns().filter((run) => (
      !workflowName || run.workflowName === workflowName
    ))
    const byId = new Map<string, Run>()
    for (const run of stored) byId.set(run.id, run)
    for (const run of live) byId.set(run.id, run)
    return [...byId.values()].sort((a, b) => (
      String(b.startedAt).localeCompare(String(a.startedAt))
    ))
  }

  async stopRun(runId: string): Promise<Run> {
    // Cascade abort to nested children first.
    const children = this.listLiveRuns().filter((run) => run.parentRunId === runId)
    for (const child of children) {
      await this.stopRun(child.id)
    }

    const coordinator = this.getLiveCoordinator(runId)
    if (coordinator) {
      const updated = await coordinator.abortRun('stopped by user')
      if (updated) {
        await this.store.saveRun(updated)
        await this.safeTranscript(runId, {
          type: 'run.abort',
          data: { reason: 'stopped by user' },
        })
        this.detachCoordinator(runId)
        return updated
      }
    }

    return this.store.updateRun(runId, (r) => markAborted(r, 'stopped by user')).then(async (updated) => {
      await this.safeTranscript(runId, {
        type: 'run.abort',
        data: { reason: 'stopped by user', offline: true },
      })
      return updated
    })
  }

  /**
   * Synchronously nest a child workflow run for a sub_workflow step.
   * Honors AbortSignal (parent step abort) and circular-ref / depth guards.
   */
  async executeSubWorkflow(
    step: Step,
    context: ExecutionContext,
    signal: AbortSignal,
  ): Promise<StepOutcome> {
    if (step.type !== StepType.SubWorkflow) {
      return { ok: false, error: `Expected sub_workflow step, got ${step.type}` }
    }
    const ref = typeof step.ref === 'string' ? step.ref.trim() : ''
    if (!ref) return { ok: false, error: 'Sub-workflow step missing ref' }

    const parentName = context.workflow.metadata.name
    const rawStack = context.params?.[WORKFLOW_STACK_PARAM]
    const stack = Array.isArray(rawStack)
      ? rawStack.map(String)
      : [parentName]
    if (stack.includes(ref)) {
      return {
        ok: false,
        error: `Circular sub_workflow: ${[...stack, ref].join(' -> ')}`,
      }
    }
    if (stack.length >= this.config.maxNestedDepth) {
      return {
        ok: false,
        error: `sub_workflow nesting exceeds maxNestedDepth (${this.config.maxNestedDepth})`,
      }
    }

    const childParams: Record<string, unknown> = {
      ...(context.params ?? {}),
      [WORKFLOW_STACK_PARAM]: [...stack, ref],
      __parentRunId: context.runId,
    }
    if (step.inputs && typeof step.inputs === 'object' && !Array.isArray(step.inputs)) {
      for (const [key, value] of Object.entries(step.inputs)) {
        if (
          typeof value === 'string'
          || typeof value === 'number'
          || typeof value === 'boolean'
        ) {
          childParams[key] = value
        }
      }
    }

    let child: Run
    try {
      const parentRun = await this.getRun(context.runId)
      child = await this.startRun(ref, childParams, {
        parentRunId: context.runId,
        rootRunId: parentRun?.rootRunId ?? context.runId,
      })
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }

    const pollMs = Math.max(50, Math.min(this.config.tickInterval, 250))
    while (true) {
      if (signal.aborted) {
        await this.stopRun(child.id).catch(() => undefined)
        return { ok: false, error: 'aborted', output: { childRunId: child.id } }
      }
      const latest = await this.getRun(child.id)
      if (!latest) {
        return { ok: false, error: `Child run disappeared: ${child.id}` }
      }
      if (latest.status === WorkflowStatus.Completed) {
        return {
          ok: true,
          output: {
            childRunId: latest.id,
            workflowName: latest.workflowName,
            status: latest.status,
            tasks: Object.fromEntries(
              Object.entries(latest.tasks).map(([id, task]) => [id, task.status]),
            ),
          },
        }
      }
      if (
        latest.status === WorkflowStatus.Failed
        || latest.status === WorkflowStatus.Aborted
      ) {
        const failedTask = Object.values(latest.tasks).find((task) => (
          task.status === TaskStatus.Failed && typeof task.error === 'string' && task.error
        ))
        return {
          ok: false,
          error: latest.error
            ?? failedTask?.error
            ?? `Child workflow "${latest.workflowName}" ${latest.status}`,
          output: {
            childRunId: latest.id,
            workflowName: latest.workflowName,
            status: latest.status,
          },
        }
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
  }

  async listPendingGates(runId?: string): Promise<PendingGateView[]> {
    const runs = runId
      ? [await this.getRun(runId)].filter((r): r is Run => r !== null)
      : await this.listRuns()

    const pending: PendingGateView[] = []
    for (const run of runs) {
      for (const gate of Object.values(run.gates) as Gate[]) {
        if (gate.resolved || !gate.token) continue
        pending.push({
          runId: run.id,
          stepId: gate.stepId,
          question: gate.question,
          options: gate.options,
          ...(gate.pass ? { pass: gate.pass } : {}),
          token: gate.token,
        })
      }
    }
    return pending
  }

  async resolveGate(
    runId: string,
    stepId: string,
    decision: string,
    resolvedBy: string,
    token: string,
  ): Promise<Run> {
    const coordinator = this.getLiveCoordinator(runId)
    if (coordinator) {
      coordinator.resolveGate(stepId, decision, resolvedBy, token)
      const updated = coordinator.getRun()
      if (!updated) throw new Error(`Run not found after resolve: ${runId}`)
      await this.store.saveRun(updated)
      await this.safeTranscript(runId, {
        type: 'gate.resolve',
        stepId,
        data: { decision, resolvedBy, live: true },
      })
      coordinator.start()
      return updated
    }

    // Offline resolve for persisted runs (no live coordinator).
    const run = await this.store.loadRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)
    const workflow = await this.getWorkflow(run.workflowName)
    const updated = resolveGate(run, stepId, decision, resolvedBy, token, {
      ...(workflow ? { workflow } : {}),
    })
    const approved = isGatePass(updated.gates[stepId]!, decision)
    await this.store.saveRun(updated)
    await this.safeTranscript(runId, {
      type: 'gate.resolve',
      stepId,
      data: { decision, resolvedBy, live: false, approved },
    })

    // Reattach so the DAG can continue after process restart / detach.
    if (!isRunComplete(updated)) {
      const resumeTarget = updated.status === WorkflowStatus.Running
        ? updated
        : { ...updated, status: WorkflowStatus.Running }
      if (resumeTarget !== updated) await this.store.saveRun(resumeTarget)
      await this.reattachRun(resumeTarget)
    }
    return this.getLiveCoordinator(runId)?.getRun() ?? updated
  }

  async resolveCollabJoinGate(
    runId: string,
    stepId: string,
    resolvedBy: string,
    token: string,
  ): Promise<Run> {
    const coordinator = this.getLiveCoordinator(runId)
    if (coordinator) {
      coordinator.resolveCollabJoinGate(stepId, token, resolvedBy)
      const updated = coordinator.getRun()
      if (!updated) throw new Error(`Run not found after resolve: ${runId}`)
      await this.store.saveRun(updated)
      await this.safeTranscript(runId, {
        type: 'gate.resolve',
        stepId,
        data: { decision: 'joined', resolvedBy, live: true, kind: 'collab_join' },
      })
      coordinator.start()
      return updated
    }

    const run = await this.store.loadRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)
    const updated = resolveCollabJoinGate(run, stepId, token, resolvedBy)
    await this.store.saveRun(updated)
    await this.safeTranscript(runId, {
      type: 'gate.resolve',
      stepId,
      data: { decision: 'joined', resolvedBy, live: false, kind: 'collab_join' },
    })

    if (!isRunComplete(updated)) {
      const resumeTarget = updated.status === WorkflowStatus.Running
        ? updated
        : { ...updated, status: WorkflowStatus.Running }
      if (resumeTarget !== updated) await this.store.saveRun(resumeTarget)
      await this.reattachRun(resumeTarget)
    }
    return this.getLiveCoordinator(runId)?.getRun() ?? updated
  }

  /** Resume a persisted running run with a live coordinator + tick loop. */
  private async reattachRun(run: Run): Promise<void> {
    if (this.coordinators.has(run.id)) return
    if (this.countActiveRuns() >= this.config.maxActiveRuns) {
      throw new Error(
        `Cannot resume run ${run.id}: maximum active runs (${this.config.maxActiveRuns}) reached.`,
      )
    }
    const workflow = await this.getWorkflow(run.workflowName)
    if (!workflow) {
      throw new Error(`Cannot resume run ${run.id}: workflow not found: ${run.workflowName}`)
    }
    const coordinator = this.createCoordinator()
    await coordinator.resume(workflow, run, this.executor)
    this.coordinators.set(run.id, coordinator)
    coordinator.start()
  }

  async getTranscript(
    runId: string,
    options: { after?: string; limit?: number } = {},
  ): Promise<{ events: TranscriptEvent[]; nextAfter?: string }> {
    return this.store.loadTranscript(runId, options)
  }

  async listBindings(): Promise<WorkspaceBinding[]> {
    return this.readBindings()
  }

  async getBinding(workspaceId: string): Promise<WorkspaceBinding | null> {
    const bindings = await this.readBindings()
    return bindings.find(b => b.workspaceId === workspaceId) ?? null
  }

  async setBinding(workspaceId: string, workflowName: string): Promise<WorkspaceBinding> {
    const workflow = await this.getWorkflow(workflowName)
    if (!workflow) throw new Error(`Workflow not found: ${workflowName}`)
    const bindings = await this.readBindings()
    const next: WorkspaceBinding = {
      workspaceId,
      workflowName,
      updatedAt: new Date().toISOString(),
    }
    const without = bindings.filter(b => b.workspaceId !== workspaceId)
    await this.writeBindings([...without, next])
    return next
  }

  async clearBinding(workspaceId: string): Promise<boolean> {
    const bindings = await this.readBindings()
    const next = bindings.filter(b => b.workspaceId !== workspaceId)
    if (next.length === bindings.length) return false
    await this.writeBindings(next)
    return true
  }

  /** Start the workflow bound to a workspace, injecting workspace context. */
  async startBoundRun(
    workspaceId: string,
    params?: Record<string, unknown>,
  ): Promise<Run> {
    const binding = await this.getBinding(workspaceId)
    if (!binding) throw new Error(`No workflow bound for workspace: ${workspaceId}`)
    return this.startRun(binding.workflowName, {
      ...params,
      workspaceId,
      ...(typeof params?.workspaceRoot === 'string'
        && (params.workspaceRoot.startsWith('/')
          || /^[A-Za-z]:[\\/]/.test(params.workspaceRoot))
        ? { workspaceRoot: params.workspaceRoot }
        : {}),
    })
  }

  /** Whether MCP may invoke destructive tools (delete/stop/resolve). */
  areDangerousMcpToolsEnabled(): boolean {
    return this.config.mcpDangerousToolsEnabled
  }

  addTrigger(config: TriggerConfig): { id: string; config: TriggerConfig } {
    this.assertTriggersEnabled()
    const { timezone: _ignored, ...rest } = config as TriggerConfig & { timezone?: string }
    const record = this.triggerManager.add(rest)
    void this.persistTriggers()
    return { id: record.id, config: record.config }
  }

  removeTrigger(id: string): boolean {
    this.assertTriggersEnabled()
    const removed = this.triggerManager.remove(id)
    if (removed) void this.persistTriggers()
    return removed
  }

  enableTrigger(id: string): void {
    this.assertTriggersEnabled()
    this.triggerManager.enable(id)
    void this.persistTriggers()
  }

  disableTrigger(id: string): void {
    this.assertTriggersEnabled()
    this.triggerManager.disable(id)
    void this.persistTriggers()
  }

  fireManualTrigger(triggerId: string, params?: Record<string, unknown>): void {
    this.assertTriggersEnabled()
    this.triggerManager.manual(triggerId, params)
  }

  listTriggers(): Array<{ id: string; config: TriggerConfig; enabled: boolean; nextTrigger?: string }> {
    if (!this.config.triggersEnabled) return []
    return this.triggerManager.list().map(r => ({
      id: r.id,
      config: r.config,
      enabled: r.enabled,
      nextTrigger: r.nextTrigger,
    }))
  }

  async deleteRun(runId: string): Promise<boolean> {
    if (this.coordinators.has(runId)) {
      await this.stopRun(runId).catch(() => undefined)
    }
    return this.store.deleteRun(runId)
  }

  async exportRun(runId: string): Promise<{
    schemaVersion: number
    run: Run
    transcript: TranscriptEvent[]
  } | null> {
    const run = await this.getRun(runId)
    if (!run) return null
    const transcript = await this.getTranscript(runId)
    return {
      schemaVersion: RUN_SCHEMA_VERSION,
      run,
      transcript: transcript.events,
    }
  }

  async purgeRuns(options: { quiet?: boolean } = {}): Promise<{ deleted: number }> {
    const maxRetained = this.settings.maxRetainedRuns
      ?? this.config.maxRetainedRuns
    const maxAgeDays = this.settings.maxRunAgeDays
      ?? this.config.maxRunAgeDays
    const runs = await this.store.listRuns()
    const liveIds = new Set(this.coordinators.keys())
    const finished = runs.filter((run) => (
      !liveIds.has(run.id)
      && run.status !== WorkflowStatus.Running
    ))
    const cutoff = maxAgeDays > 0
      ? Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
      : null
    const toDelete = new Set<string>()
    for (const run of finished) {
      const completedMs = Date.parse(run.completedAt ?? run.startedAt)
      if (cutoff !== null && Number.isFinite(completedMs) && completedMs < cutoff) {
        toDelete.add(run.id)
      }
    }
    if (maxRetained > 0) {
      const keep = finished
        .filter((run) => !toDelete.has(run.id))
        .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
      for (const run of keep.slice(maxRetained)) {
        toDelete.add(run.id)
      }
    }
    let deleted = 0
    for (const runId of toDelete) {
      if (await this.store.deleteRun(runId)) deleted += 1
    }
    if (!options.quiet && deleted > 0) {
      console.log(`[workflow] purged ${deleted} retained run(s)`)
    }
    return { deleted }
  }

  fireEvent(source: string, name: string, data?: Record<string, unknown>): void {
    this.assertTriggersEnabled()
    this.triggerManager.fireEvent({
      source,
      name,
      data,
      timestamp: new Date().toISOString(),
    })
  }

  private assertTriggersEnabled(): void {
    if (!this.config.triggersEnabled) {
      throw new Error(
        'Workflow triggers are disabled. Set triggersEnabled: true when constructing WorkflowPlugin to use cron/event/manual triggers.',
      )
    }
  }

  private async handleTrigger(config: TriggerConfig): Promise<void> {
    if (!this.config.triggersEnabled) return
    try {
      await this.startRun(config.workflowName, config.params)
      console.log(`[workflow] Triggered workflow: ${config.workflowName}`)
    } catch (error) {
      console.error('[workflow] Trigger failed:', error)
    }
  }

  async getStats(): Promise<{
    workflows: number
    runs: { total: number; running: number; completed: number; failed: number }
    triggers: number
    activeRuns: number
    maxActiveRuns: number
    apiVersion: number
    runSchemaVersion: number
    coordinators: Array<{ runId: string; stats: ReturnType<Coordinator['getStats']> }>
  }> {
    const workflows = await this.store.listWorkflows()
    const allRuns = await this.listRuns()
    const coordinators = [...this.coordinators.entries()].map(([runId, coordinator]) => ({
      runId,
      stats: coordinator.getStats(),
    }))

    return {
      workflows: workflows.length,
      runs: {
        total: allRuns.length,
        running: allRuns.filter(r => r.status === 'running').length,
        completed: allRuns.filter(r => r.status === 'completed').length,
        failed: allRuns.filter(r => r.status === 'failed').length,
      },
      triggers: this.triggerManager.list().length,
      activeRuns: this.countActiveRuns(),
      maxActiveRuns: this.config.maxActiveRuns,
      apiVersion: 1,
      runSchemaVersion: RUN_SCHEMA_VERSION,
      coordinators,
    }
  }

  /**
   * Per-workflow usage summaries from retained top-level runs.
   * When `workflowName` is set, returns a single-element array (zeros if unknown / no runs).
   */
  async getWorkflowStats(workflowName?: string): Promise<WorkflowStatsSummary[]> {
    const workflows = await this.listWorkflows()
    const allRuns = await this.listRuns()
    if (workflowName) {
      const workflow = workflows.find((entry) => entry.metadata.name === workflowName)
      return [summarizeWorkflowRuns(
        workflowName,
        allRuns.filter((run) => run.workflowName === workflowName),
        workflow?.metadata.title,
      )]
    }
    return buildWorkflowStatsSummaries(workflows, allRuns)
  }

  async getWorkflowStatsDetail(
    workflowName: string,
    options?: { since?: string; recentLimit?: number },
  ): Promise<WorkflowStatsDetail> {
    const workflows = await this.listWorkflows()
    const allRuns = await this.listRuns(workflowName)
    return buildWorkflowStatsDetail(workflowName, workflows, allRuns, options)
  }

  private shutdown: Promise<void> = Promise.resolve()

  stop(): void {
    const runIds = [...this.coordinators.keys()]
    this.shutdown = Promise.all(runIds.map(async (runId) => {
      try {
        await this.stopRun(runId)
      } catch (error) {
        console.error(`[workflow] stopRun(${runId}) during plugin.stop failed:`, error)
        this.detachCoordinator(runId)
      }
    })).then(() => undefined)
    this.triggerManager.stop()
  }

  /** Await in-flight shutdown from {@link stop} (tests / Host teardown). */
  async whenStopped(): Promise<void> {
    await this.shutdown
  }

  // --- RSI 自我迭代改进 ---

  private rsiProblems: Array<{
    id: number; title: string; domain: string; maxIterations: number
    reviewProviderId: number; improvementCriteria: string; baseYaml: string
    status: string; scenarioCount: number
  }> = []
  private rsiIterationsMap: Map<number, Array<{
    id: number; iterationNumber: number; reviewScore: number
    reviewFeedback: string; improvedYaml: string; status: string; durationMs: number
  }>> = new Map()
  private rsiNextId = 1

  async rsiListProblems() {
    return this.rsiProblems.map(p => ({
      id: p.id, title: p.title, domain: p.domain,
      maxIterations: p.maxIterations, status: p.status, scenarioCount: p.scenarioCount,
    }))
  }

  async rsiCreateProblem(config: {
    title: string; domain?: string; maxIterations?: number
    reviewProviderId?: number; improvementCriteria?: string; baseYaml?: string
  }) {
    const id = this.rsiNextId++
    this.rsiProblems.push({
      id,
      title: config.title,
      domain: config.domain || 'summarization',
      maxIterations: config.maxIterations || 5,
      reviewProviderId: config.reviewProviderId || 0,
      improvementCriteria: config.improvementCriteria || '',
      baseYaml: config.baseYaml || '',
      status: 'draft',
      scenarioCount: 0,
    })
    return { id }
  }

  async rsiRunIteration(problemId: number) {
    const problem = this.rsiProblems.find(p => p.id === problemId)
    if (!problem) throw new Error('problem not found')
    const iterations = this.rsiIterationsMap.get(problemId) || []
    const iterNum = iterations.length
    const start = Date.now()
    const previous = iterations[iterations.length - 1]
    const yaml = previous?.improvedYaml || problem.baseYaml
    const request: RsiReviewRequest = {
      problemId,
      title: problem.title,
      domain: problem.domain,
      improvementCriteria: problem.improvementCriteria,
      iterationNumber: iterNum,
      yaml,
      ...(previous?.reviewFeedback ? { priorFeedback: previous.reviewFeedback } : {}),
    }
    // Host reviewer when wired (Desktop / awf-node); otherwise the deterministic
    // stub keeps the loop runnable on a pure-Node engine.
    let status = 'completed'
    let result: RsiReviewResult
    const reviewer = this.hostHooks.runRsiReview
    if (reviewer) {
      try {
        result = await reviewer(request)
      } catch (error) {
        status = 'failed'
        result = {
          score: 0,
          feedback: `评审失败: ${error instanceof Error ? error.message : String(error)}`,
          improvedYaml: yaml,
        }
      }
    } else {
      result = {
        score: Math.min(100, 50 + iterNum * 10),
        feedback: `迭代 ${iterNum}: ${iterNum === 0 ? '初始基线评估' : '基于前次反馈改进'}`,
        improvedYaml: yaml,
      }
    }
    const iteration = {
      id: iterNum + 1, iterationNumber: iterNum,
      reviewScore: Math.min(100, Math.max(0, result.score)),
      reviewFeedback: result.feedback,
      improvedYaml: result.improvedYaml, status, durationMs: Date.now() - start,
    }
    iterations.push(iteration)
    this.rsiIterationsMap.set(problemId, iterations)
    problem.status = status !== 'completed'
      ? 'running'
      : iterNum + 1 >= problem.maxIterations ? 'completed' : 'running'
    return {
      iterationNumber: iteration.iterationNumber,
      reviewScore: iteration.reviewScore,
      reviewFeedback: iteration.reviewFeedback,
      improvedYaml: iteration.improvedYaml,
    }
  }

  async rsiGetIterations(problemId: number) {
    return this.rsiIterationsMap.get(problemId) || []
  }

  async rsiDeleteProblem(problemId: number) {
    const idx = this.rsiProblems.findIndex(p => p.id === problemId)
    if (idx < 0) return { ok: false }
    this.rsiProblems.splice(idx, 1)
    this.rsiIterationsMap.delete(problemId)
    return { ok: true }
  }

  private async readBindings(): Promise<WorkspaceBinding[]> {
    try {
      const raw = await readFile(this.bindingsPath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed.filter((item): item is WorkspaceBinding => (
        typeof item === 'object'
        && item !== null
        && typeof (item as WorkspaceBinding).workspaceId === 'string'
        && typeof (item as WorkspaceBinding).workflowName === 'string'
        && typeof (item as WorkspaceBinding).updatedAt === 'string'
      ))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  private async writeBindings(bindings: WorkspaceBinding[]): Promise<void> {
    await mkdir(this.config.stateDir, { recursive: true })
    await writeFile(this.bindingsPath, JSON.stringify(bindings, null, 2), 'utf8')
  }

  private async readSettings(): Promise<WorkflowSettings> {
    try {
      const raw = await readFile(this.settingsPath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<WorkflowSettings>
      return {
        defaultBias: typeof parsed.defaultBias === 'string' ? parsed.defaultBias : 'coding',
        defaultRetries: normalizeRetries(parsed.defaultRetries),
        defaultOnFailure: normalizeOnFailure(parsed.defaultOnFailure),
        maxRetainedRuns: normalizeNonNegInt(parsed.maxRetainedRuns, this.config.maxRetainedRuns),
        maxRunAgeDays: normalizeNonNegInt(parsed.maxRunAgeDays, this.config.maxRunAgeDays),
        scriptPolicy: normalizeScriptPolicy(parsed.scriptPolicy, this.config.scriptPolicy),
        providers: Array.isArray(parsed.providers) ? parsed.providers : [],
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          ...defaultWorkflowSettings(),
          scriptPolicy: this.config.scriptPolicy,
          maxRetainedRuns: this.config.maxRetainedRuns,
          maxRunAgeDays: this.config.maxRunAgeDays,
        }
      }
      throw error
    }
  }

  private async persistTriggers(): Promise<void> {
    if (!this.config.triggersEnabled) return
    await mkdir(this.config.stateDir, { recursive: true })
    const records = this.triggerManager.list()
    await writeFile(this.triggersPath, JSON.stringify(records, null, 2), 'utf8')
  }

  private async loadPersistedTriggers(): Promise<void> {
    try {
      const raw = await readFile(this.triggersPath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return
      for (const item of parsed) {
        if (!item || typeof item !== 'object') continue
        const record = item as TriggerRecord
        if (typeof record.id !== 'string' || !record.config?.workflowName) continue
        this.triggerManager.restore({
          id: record.id,
          config: record.config,
          enabled: record.enabled !== false,
          createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
          ...(record.lastTriggered ? { lastTriggered: record.lastTriggered } : {}),
          ...(record.nextTrigger ? { nextTrigger: record.nextTrigger } : {}),
        })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
  }
}

export function createWorkflowPlugin(config?: WorkflowPluginConfig): WorkflowPlugin {
  return new WorkflowPlugin(config)
}

export default WorkflowPlugin
