/**
 * Host-bound workflow step runners for LLM and ephemeral code-agent tasks.
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage, BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { FinishReason, GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  buildRsiReviewPrompt,
  createDesktopExecutor,
  parseRsiReviewResponse,
  RSI_REVIEW_MAX_TOKENS,
  type DesktopExecutorHooks,
  type RsiReviewRequest,
  type RsiReviewResult,
  type StepOutcome,
} from 'dsh-plugin-workflow/engine'
import type { ExecutionContext, Executor, Step } from 'dsh-plugin-workflow/engine'
import type { WorkflowSettings } from 'dsh-plugin-workflow'
import { isLocalDesktopJid, parseJid, peerKindFromJid } from 'dsh-plugin-workflow/collab'

interface ModelRoute {
  provider: string
  model: string
}

/** Services used by Host-bound workflow step execution. */
export interface DesktopWorkflowHostServices {
  llm: {
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>
  }
  agents?: {
    create(options: {
      sessionId: ReturnType<typeof SessionId>
      meta?: { cwd?: string; origin?: 'subagent' }
      agentOptions?: { provider?: string; model?: string }
      signal?: AbortSignal
    }): Promise<AgentHandle>
    get?(sessionId: ReturnType<typeof SessionId>): AgentHandle | undefined
  }
  agentDefaultModel?: {
    currentSelection(): ModelRoute
  }
  /** Optional workflow LLM preference lookup (bias → provider/model). */
  getWorkflowSettings?: () => WorkflowSettings
  /** AWF platform remote run (P7 collab_peer awf@ workflow peer). */
  /** Prefer waiting until AWF run reaches a terminal or gate state when provided. */
  awfRemoteRunAndWait?: (input: {
    workflowId: number
    params?: Record<string, string>
    externalLoopId?: string
    externalBranchId?: string
    timeoutMs?: number
    signal?: AbortSignal
  }) => Promise<{
    ok: boolean
    status?: string
    resultText?: string
    errorText?: string
    runId?: number
    runnerRunId?: string
    gates?: ReadonlyArray<{ token: string; step_id?: string; resolved?: boolean }>
    errorKind?: string
    errorMessage?: string
  }>
  awfRemoteRun?: (input: {
    workflowId: number
    params?: Record<string, string>
    externalLoopId?: string
    externalBranchId?: string
  }) => Promise<{
    ok: boolean
    status?: string
    resultText?: string
    errorText?: string
    runId?: number
    runnerRunId?: string
    gates?: ReadonlyArray<{ token: string; step_id?: string; resolved?: boolean }>
    errorKind?: string
    errorMessage?: string
  }>
  awfResolveGate?: (input: {
    runnerRunId: string
    token: string
    decision: string
  }) => Promise<{
    ok: boolean
    status?: string
    resultText?: string
    errorText?: string
    runId?: number
    runnerRunId?: string
    gates?: ReadonlyArray<{ token: string; step_id?: string; resolved?: boolean }>
    errorKind?: string
    errorMessage?: string
  }>
  awfPollRun?: (input: {
    runnerRunId: string
    timeoutMs?: number
    signal?: AbortSignal
  }) => Promise<{
    ok: boolean
    status?: string
    resultText?: string
    errorText?: string
    runId?: number
    runnerRunId?: string
    gates?: ReadonlyArray<{ token: string; step_id?: string; resolved?: boolean }>
    errorKind?: string
    errorMessage?: string
  }>
}

function parseProviderModel(value: string): ModelRoute | undefined {
  if (!value.includes('/')) return undefined
  const slash = value.indexOf('/')
  return {
    provider: value.slice(0, slash),
    model: value.slice(slash + 1),
  }
}

function resolveRouteFor(
  model: string | undefined,
  role: string | undefined,
  services: DesktopWorkflowHostServices,
): ModelRoute {
  if (typeof model === 'string' && model.includes('/')) {
    const parsed = parseProviderModel(model)
    if (parsed) return parsed
  }

  const settings = services.getWorkflowSettings?.()
  if (settings?.providers?.length) {
    const lowered = typeof role === 'string' ? role.toLowerCase() : ''
    const want = lowered || settings.defaultBias.toLowerCase()
    const matched = settings.providers.find((entry) => (
      entry.bias.some((tag) => tag.toLowerCase() === want)
      || entry.bias.some((tag) => want.includes(tag.toLowerCase()))
    )) ?? settings.providers.find((entry) => (
      entry.bias.some((tag) => tag.toLowerCase() === settings.defaultBias.toLowerCase())
    ))
    if (matched) {
      const parsed = parseProviderModel(matched.model)
      if (parsed) return parsed
    }
  }

  const selected = services.agentDefaultModel?.currentSelection()
  if (selected?.provider && selected?.model) {
    return {
      provider: selected.provider,
      model: typeof model === 'string' && model.length > 0 ? model : selected.model,
    }
  }
  if (typeof model === 'string' && model.length > 0) {
    throw new Error(`workflow executor: model "${model}" needs provider/model or agentDefaultModel`)
  }
  throw new Error('workflow executor: no model route available')
}

function resolveRoute(step: Step, services: DesktopWorkflowHostServices): ModelRoute {
  return resolveRouteFor(step.model, step.role, services)
}

function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens':
      return new Error('workflow executor: model output reached maxTokens')
    case 'tool-calls':
      return new Error('workflow executor: unexpected tool call in one-shot LLM step')
    default:
      return new Error(`workflow executor: unsupported finish reason`)
  }
}

function substituteParams(text: string, context: ExecutionContext): string {
  const params = context.params ?? {}
  return text.replace(/\$([A-Z][A-Z0-9_]*)/g, (match, key: string) => {
    const fromEnv = context.env?.[key]
    if (typeof fromEnv === 'string') return fromEnv
    const fromParams = params[key] ?? params[key.toLowerCase()]
    if (typeof fromParams === 'string' || typeof fromParams === 'number') return String(fromParams)
    return match
  })
}

function formatStepOutput(output: unknown): string {
  if (typeof output === 'string') return output
  if (output && typeof output === 'object') {
    const record = output as Record<string, unknown>
    if (typeof record.text === 'string' && record.text.trim()) return record.text
    if (typeof record.stdout === 'string' && record.stdout.trim()) return record.stdout
    try {
      return JSON.stringify(output, null, 2)
    } catch {
      return String(output)
    }
  }
  return String(output)
}

function appendContextSections(prompt: string, context: ExecutionContext): string {
  const sections: string[] = []
  if (context.shared && Object.keys(context.shared).length > 0) {
    sections.push(`## Shared vision\n\n${formatStepOutput(context.shared)}`)
  }
  const outputs = context.stepOutputs
  if (outputs && Object.keys(outputs).length > 0) {
    const deps = Object.entries(outputs).map(([stepId, output]) => (
      `### ${stepId}\n${formatStepOutput(output)}`
    ))
    sections.push(`## Upstream step outputs\n\n${deps.join('\n\n')}`)
  }
  if (sections.length === 0) return prompt
  return `${prompt}\n\n${sections.join('\n\n')}`
}

function buildLlmPrompt(step: Step, context: ExecutionContext): string {
  return appendContextSections(substituteParams(step.prompt ?? '', context), context)
}

/** Default / clamp LLM completion budget for workflow steps. */
function resolveLlmMaxTokens(step: Step): number {
  const raw = step.maxTokens
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.min(Math.max(Math.floor(raw), 256), 32_768)
  }
  // Stock-review / multi-LLM steps often need more than the old 2048 default.
  return 8192
}

async function runLlmStep(
  services: DesktopWorkflowHostServices,
  step: Step,
  context: ExecutionContext,
  signal: AbortSignal,
): Promise<StepOutcome> {
  if (!step.prompt) return { ok: false, error: 'LLM step missing prompt' }
  signal.throwIfAborted()
  const route = resolveRoute(step, services)
  const prompt = buildLlmPrompt(step, context)
  const messages: Message[] = [createUserMessage({
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'plugin', plugin: 'dsh-plugin-desktop/workflow' },
  })]
  const options: GenerateOptions = {
    provider: route.provider,
    model: route.model,
    messages,
    system: [
      'You are assisting a Desktop workflow step.',
      'Return only the step result the workflow needs.',
      step.role ? `Role: ${step.role}` : '',
    ].filter(Boolean).join('\n'),
    maxTokens: resolveLlmMaxTokens(step),
    sessionId: SessionId(`workflow-llm-${randomUUID()}`),
    signal,
  }

  const assembler = new BlockAssembler()
  for await (const chunk of services.llm.stream(options)) {
    signal.throwIfAborted()
    assembler.push(chunk)
  }
  signal.throwIfAborted()
  const terminalError = finishError(assembler.finish)
  if (terminalError) return { ok: false, error: terminalError.message }

  const blocks = assembler.blocks()
  const text = blocks
    .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim()
  if (!text) return { ok: false, error: 'workflow executor: empty LLM response' }
  return {
    ok: true,
    output: { text, provider: route.provider, model: route.model },
  }
}

/** Run one RSI review/improve pass through the Host LLM service. */
export async function runRsiReview(
  services: DesktopWorkflowHostServices,
  request: RsiReviewRequest,
  signal?: AbortSignal,
): Promise<RsiReviewResult> {
  signal?.throwIfAborted()
  // Review passes bias toward review-capable routes the way steps bias by role.
  const route = resolveRouteFor(undefined, 'review', services)
  const prompt = buildRsiReviewPrompt(request)
  const messages: Message[] = [createUserMessage({
    content: [{ type: 'text', text: prompt.user }],
    source: { kind: 'plugin', plugin: 'dsh-plugin-desktop/workflow' },
  })]
  const options: GenerateOptions = {
    provider: route.provider,
    model: route.model,
    messages,
    system: prompt.system,
    maxTokens: RSI_REVIEW_MAX_TOKENS,
    sessionId: SessionId(`workflow-rsi-${randomUUID()}`),
    ...(signal ? { signal } : {}),
  }

  const assembler = new BlockAssembler()
  for await (const chunk of services.llm.stream(options)) {
    signal?.throwIfAborted()
    assembler.push(chunk)
  }
  signal?.throwIfAborted()
  const terminalError = finishError(assembler.finish)
  if (terminalError) throw terminalError

  const blocks = assembler.blocks()
  const text = blocks
    .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim()
  if (!text) throw new Error('rsi review: empty LLM response')
  return parseRsiReviewResponse(text, request.yaml)
}

function buildTaskPrompt(step: Step, context: ExecutionContext, cwd: string): string {
  const lines = [
    `You are executing workflow task step "${step.id}" in workspace ${cwd}.`,
  ]
  if (step.role) lines.push(`Role: ${step.role}`)
  if (step.inputs) lines.push(`Inputs JSON:\n${JSON.stringify(step.inputs, null, 2)}`)
  if (step.acceptance?.length) {
    lines.push('Acceptance criteria:')
    for (const item of step.acceptance) lines.push(`- ${item}`)
  }
  if (step.prompt) lines.push(substituteParams(step.prompt, context))
  else lines.push('Complete the task and report concrete findings and next actions.')
  if (step.outputs?.length) {
    lines.push(`Produce these outputs when possible: ${step.outputs.join(', ')}`)
  }
  return appendContextSections(lines.join('\n'), context)
}

function extractAssistantText(handle: AgentHandle): string {
  const events = handle.agent.session.snapshotEvents()
  const parts: string[] = []
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const message = (event.data as { message?: { content?: Array<{ type?: string; text?: string }> } }).message
    for (const block of message?.content ?? []) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        parts.push(block.text.trim())
      }
    }
  }
  return parts.join('\n\n').trim()
}

/** Run one `task` step through the Host agent path (also reused by the AWF executor). */
export async function runTaskStep(
  services: DesktopWorkflowHostServices,
  step: Step,
  context: ExecutionContext,
  cwd: string,
  signal: AbortSignal,
): Promise<StepOutcome> {
  if (!services.agents) {
    return { ok: false, error: 'Task steps require ctx.agents' }
  }
  signal.throwIfAborted()
  const route = (() => {
    try {
      return resolveRoute(step, services)
    } catch {
      return undefined
    }
  })()

  const sessionId = SessionId(`workflow-task-${randomUUID()}`)
  const createOptions: Parameters<NonNullable<DesktopWorkflowHostServices['agents']>['create']>[0] = {
    sessionId,
    meta: { cwd, origin: 'subagent' },
    signal,
  }
  if (route) {
    createOptions.agentOptions = { provider: route.provider, model: route.model }
  }
  const handle = await services.agents.create(createOptions)

  try {
    signal.throwIfAborted()
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: buildTaskPrompt(step, context, cwd) }],
      source: { kind: 'plugin', plugin: 'dsh-plugin-desktop/workflow' },
    }))
    await Promise.race([
      handle.agent.whenIdle(),
      new Promise<never>((_, reject) => {
        if (signal.aborted) {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          return
        }
        signal.addEventListener('abort', () => {
          void handle.agent.cancel({ kind: 'disposed' })
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        }, { once: true })
      }),
    ])
    const text = extractAssistantText(handle)
    if (!text) return { ok: false, error: 'workflow executor: task agent produced no assistant text' }
    const output: Record<string, unknown> = {
      text,
      sessionId: String(sessionId),
    }
    if (step.role) output.role = step.role
    if (route?.provider) output.provider = route.provider
    if (route?.model) output.model = route.model
    return { ok: true, output }
  } catch (error) {
    if (signal.aborted) return { ok: false, error: 'aborted' }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await handle.dispose().catch(() => undefined)
  }
}

function isRemoteCollabJid(jid: string): boolean {
  try {
    const parsed = parseJid(jid)
    if (parsed.domain !== 'desktop.local') return true
    const node = parsed.node.toLowerCase()
    if (node.startsWith('remote.') || node.includes('remote')) return true
    return false
  } catch {
    return true
  }
}

function collabParamsFromContext(context: ExecutionContext): Record<string, string> {
  const out: Record<string, string> = {}
  const params = context.params ?? {}
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' || typeof value === 'number') out[key] = String(value)
  }
  const env = context.env ?? {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}

function pickExternalId(params: Record<string, string>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = params[key]?.trim()
    if (value) return value
  }
  return undefined
}

function firstUnresolvedGateToken(
  gates: ReadonlyArray<{ token: string; resolved?: boolean }> | undefined,
): string | undefined {
  if (!gates?.length) return undefined
  const open = gates.find((g) => g.token && g.resolved !== true)
  return open?.token ?? gates[0]?.token
}

/** Validate peer JID and dispatch local attach or AWF remote.workflow (P7). */
export async function runCollabPeerStep(
  services: DesktopWorkflowHostServices,
  step: Step,
  context: ExecutionContext,
  _cwd: string,
  signal: AbortSignal,
): Promise<StepOutcome> {
  signal.throwIfAborted()
  const peer = step.peer
  if (!peer) return { ok: false, error: 'collab_peer step missing peer config' }

  const jid = peer.jid?.trim()
  if (jid && !isLocalDesktopJid(jid)) {
    return { ok: false, error: `remote collab peer rejected: ${jid} (domain must be desktop.local)` }
  }
  if (jid && isRemoteCollabJid(jid)) {
    return { ok: false, error: `remote collab peer rejected: ${jid}` }
  }

  if (peer.kind === 'session') {
    if (!jid) return { ok: false, error: 'session peer requires jid' }
    return {
      ok: true,
      output: {
        kind: 'session',
        jid,
        note: 'local session peer attached; presence heartbeat expected from client',
      },
    }
  }

  if (peer.kind === 'agent') {
    if (!jid) return { ok: false, error: 'agent peer requires jid' }
    return {
      ok: true,
      output: {
        kind: 'agent',
        jid,
        note: 'local agent peer attached; Host agent wiring deferred',
      },
    }
  }

  if (peer.kind === 'workflow') {
    if (!jid) return { ok: false, error: 'workflow peer requires jid' }
    let node: string
    try {
      node = parseJid(jid).node
    } catch {
      return { ok: false, error: `invalid workflow peer jid: ${jid}` }
    }
    if (node === 'awf') {
      const resource = parseJid(jid).resource?.trim()
      if (!resource) {
        return { ok: false, error: 'AWF workflow peer requires platform workflow id in JID resource' }
      }
      const workflowId = Number(resource)
      if (!Number.isFinite(workflowId) || workflowId <= 0) {
        return { ok: false, error: `invalid AWF workflow id in JID resource: ${resource}` }
      }
      if (!services.awfRemoteRunAndWait && !services.awfRemoteRun) {
        return { ok: false, error: 'AWF remote run unavailable (Host AWF bridge not wired)' }
      }
      signal.throwIfAborted()
      const params = collabParamsFromContext(context)
      const externalLoopId = pickExternalId(params, ['external_loop_id', 'COLLAB_LOOP_ID', 'collab_loop_id'])
      const externalBranchId = pickExternalId(params, ['external_branch_id', 'COLLAB_BRANCH_ID', 'collab_branch_id'])
      const gateDecision = pickExternalId(params, ['AWF_GATE_DECISION', 'awf_gate_decision'])
      const remoteInput = {
        workflowId,
        params,
        ...(externalLoopId ? { externalLoopId } : {}),
        ...(externalBranchId ? { externalBranchId } : {}),
      }
      let remote = services.awfRemoteRunAndWait
        ? await services.awfRemoteRunAndWait({
          ...remoteInput,
          signal,
        })
        : await services.awfRemoteRun!(remoteInput)
      if (!remote.ok) {
        return {
          ok: false,
          error: remote.errorMessage ?? remote.errorKind ?? 'AWF remote run failed',
        }
      }
      if (remote.status === 'waiting_gate') {
        const token = firstUnresolvedGateToken(remote.gates)
        const runnerRunId = remote.runnerRunId
        if (gateDecision && token && runnerRunId && services.awfResolveGate) {
          signal.throwIfAborted()
          const resolved = await services.awfResolveGate({
            runnerRunId,
            token,
            decision: gateDecision,
          })
          if (!resolved.ok) {
            return {
              ok: false,
              error: resolved.errorMessage
                ?? `AWF resolveGate failed (runnerRunId=${runnerRunId}, token=${token})`,
            }
          }
          if (services.awfPollRun && !['finished', 'failed', 'completed', 'waiting_gate'].includes(resolved.status ?? '')) {
            signal.throwIfAborted()
            remote = await services.awfPollRun({ runnerRunId, signal })
            if (!remote.ok) {
              return {
                ok: false,
                error: remote.errorMessage ?? 'AWF poll after resolveGate failed',
              }
            }
          } else {
            remote = resolved
          }
          if (remote.status === 'waiting_gate') {
            const nextToken = firstUnresolvedGateToken(remote.gates) ?? token
            return {
              ok: false,
              error: `AWF run still waiting_gate after resolve (runnerRunId=${runnerRunId}, token=${nextToken}); set AWF_GATE_DECISION and retry`,
            }
          }
        } else {
          const tokenHint = token ? `, token=${token}` : ''
          return {
            ok: false,
            error: `AWF run waiting_gate (runnerRunId=${runnerRunId ?? remote.runId ?? '?'}${tokenHint}); resolve as JWT owner or set AWF_GATE_DECISION`,
          }
        }
      }
      if (remote.status === 'failed') {
        return {
          ok: false,
          error: remote.errorText ?? remote.errorMessage ?? 'AWF remote run failed',
        }
      }
      return {
        ok: true,
        output: {
          kind: 'workflow',
          remote: 'awf',
          workflowId,
          jid,
          status: remote.status,
          runId: remote.runId,
          runnerRunId: remote.runnerRunId,
          ...(remote.resultText !== undefined ? { resultText: remote.resultText } : {}),
          ...(remote.errorText !== undefined ? { errorText: remote.errorText } : {}),
          note: 'AWF remote run waited (auto_approve=false)',
        },
      }
    }
    if (node !== 'workflow') {
      return { ok: false, error: `unsupported workflow peer node: ${node}` }
    }
    const ref = parseJid(jid).resource ?? jid
    return {
      ok: true,
      output: {
        kind: 'workflow',
        ref,
        jid,
        note: 'local workflow peer stub; executeSubWorkflow wiring deferred',
      },
    }
  }

  try {
    if (jid) peerKindFromJid(jid)
  } catch {
    // peer.kind is authoritative when jid absent or generic
  }
  return { ok: false, error: `unsupported collab peer kind: ${peer.kind}` }
}

/** Build Host hooks that call Cordis LLM / agents services. */
export function createDesktopWorkflowHostHooks(
  services: DesktopWorkflowHostServices,
): DesktopExecutorHooks {
  return {
    runLlm: (step, context, _cwd, signal) => runLlmStep(services, step, context, signal),
    runTask: (step, context, cwd, signal) => runTaskStep(services, step, context, cwd, signal),
    runRsiReview: (request, signal) => runRsiReview(services, request, signal),
    runCollabPeer: (step, context, cwd, signal) => runCollabPeerStep(services, step, context, cwd, signal),
  }
}

/** Create a Desktop executor with optional Host-bound LLM/task runners. */
export function createDesktopHostExecutor(
  services?: DesktopWorkflowHostServices,
  options: { cwd?: string } = {},
): Executor {
  const executorOptions: { cwd?: string; hooks?: DesktopExecutorHooks } = {}
  if (options.cwd !== undefined) executorOptions.cwd = options.cwd
  if (services) executorOptions.hooks = createDesktopWorkflowHostHooks(services)
  return createDesktopExecutor(executorOptions)
}

/** Read Cordis services from a live Desktop Host context when present. */
export function hostServicesFromContext(ctx: Context): DesktopWorkflowHostServices | undefined {
  const llm = ctx.get('llm') as DesktopWorkflowHostServices['llm'] | undefined
  if (!llm) return undefined
  const services: DesktopWorkflowHostServices = { llm }
  const agents = ctx.get('agents') as DesktopWorkflowHostServices['agents'] | undefined
  if (agents) services.agents = agents
  const agentDefaultModel = ctx.get('agentDefaultModel') as DesktopWorkflowHostServices['agentDefaultModel'] | undefined
  if (agentDefaultModel) services.agentDefaultModel = agentDefaultModel
  return services
}
