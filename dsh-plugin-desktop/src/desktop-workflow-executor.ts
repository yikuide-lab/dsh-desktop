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
  createDesktopExecutor,
  type DesktopExecutorHooks,
  type StepOutcome,
} from 'dsh-plugin-workflow/engine'
import type { ExecutionContext, Executor, Step } from 'dsh-plugin-workflow/engine'
import type { WorkflowSettings } from 'dsh-plugin-workflow'

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
}

function parseProviderModel(value: string): ModelRoute | undefined {
  if (!value.includes('/')) return undefined
  const slash = value.indexOf('/')
  return {
    provider: value.slice(0, slash),
    model: value.slice(slash + 1),
  }
}

function resolveRoute(
  step: Step,
  services: DesktopWorkflowHostServices,
): ModelRoute {
  if (typeof step.model === 'string' && step.model.includes('/')) {
    const parsed = parseProviderModel(step.model)
    if (parsed) return parsed
  }

  const settings = services.getWorkflowSettings?.()
  if (settings?.providers?.length) {
    const role = typeof step.role === 'string' ? step.role.toLowerCase() : ''
    const want = role || settings.defaultBias.toLowerCase()
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
      model: typeof step.model === 'string' && step.model.length > 0 ? step.model : selected.model,
    }
  }
  if (typeof step.model === 'string' && step.model.length > 0) {
    throw new Error(`workflow executor: model "${step.model}" needs provider/model or agentDefaultModel`)
  }
  throw new Error('workflow executor: no model route available')
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

/** Build Host hooks that call Cordis LLM / agents services. */
export function createDesktopWorkflowHostHooks(
  services: DesktopWorkflowHostServices,
): DesktopExecutorHooks {
  return {
    runLlm: (step, context, _cwd, signal) => runLlmStep(services, step, context, signal),
    runTask: (step, context, cwd, signal) => runTaskStep(services, step, context, cwd, signal),
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
