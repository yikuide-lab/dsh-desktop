/**
 * AI-assisted workflow design: one-shot LLM → canonicalize → validate (no save).
 */

import { createUserMessage, BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type { WorkflowPlugin } from 'dsh-plugin-workflow'
import type { Context } from '@deepseek-ai/cordis'
import {
  hostServicesFromContext,
  type DesktopWorkflowHostServices,
} from './desktop-workflow-executor.ts'
import { listWorkflowModelCatalog } from './desktop-workflow-models.ts'

export type WorkflowDesignMode = 'create' | 'modify'

export interface DesignWorkflowInput {
  readonly prompt: string
  /** Current draft YAML when modifying an existing design. */
  readonly yaml?: string
  readonly mode?: WorkflowDesignMode
  /**
   * When true, inject the live DSH model catalog into the design prompt so
   * step.model values are chosen only from installed/available routes.
   */
  readonly includeModelCatalog?: boolean
  /**
   * Explicit `provider/model` route that generates the design YAML.
   * When omitted, falls back to workflow provider bias / agent default.
   */
  readonly designModel?: string
  /** Cap for the design completion (clamped). Default 16384. */
  readonly maxTokens?: number
}

export interface DesignWorkflowResult {
  readonly yaml: string
  readonly mode: WorkflowDesignMode
  readonly validation: {
    readonly ok: boolean
    readonly errors: Array<{ path: string; message: string; severity: string }>
  }
}

/** Preference routes exposed to the design LLM (step.model only — never in prompt). */
export interface DesignModelRoute {
  readonly id: string
  readonly model: string
}

/** One catalog provider group for design prompt injection. */
export interface DesignCatalogProvider {
  readonly id: string
  readonly name: string
  readonly models: readonly { id: string; name: string }[]
}

export interface DesignPromptModelContext {
  readonly preferenceRoutes?: readonly DesignModelRoute[]
  readonly catalogProviders?: readonly DesignCatalogProvider[]
}

export const DESIGN_SYSTEM = `You are a workflow designer for DSH Desktop.
Output exactly one Workflow YAML document and nothing else.
No markdown fences, no commentary, no leading/trailing prose.

Hard requirements:
- apiVersion: workflow-wise/v1
- kind: Workflow
- metadata.name: lowercase [a-z0-9-]+, length <= 63
- metadata.uid: stable UUID document id. When present on the current draft, KEEP it unchanged. Never invent or replace uid. New workflows may omit uid (Host allocates on save).
- metadata.title and metadata.description are encouraged
- spec.steps: non-empty array
- Each step needs id ([a-z0-9-]+) and type in: script, task, llm, approval, sub_workflow
- script steps need run
- llm steps need prompt
- approval steps need question and options (array)
- approval may include pass: list of options that mean success
- task steps may include role, inputs, outputs, acceptance
- sub_workflow steps need ref (name of another saved workflow)
- Use deps: [step-id, ...] for ordering; no cycles
- Prefer small, practical graphs (3–8 steps) unless the user asks otherwise
- When modifying an existing workflow, keep metadata.uid and metadata.name unless the user asks to rename (name only; never change uid)
- You may include optional ui: { x, y } on steps for canvas layout

Model routing vs prompt (critical):
- NEVER put provider ids, model ids, or vendor product names inside step.prompt
  (e.g. openai/..., gpt-4o, claude-*, deepseek-*, gemini-*). Changing step.model must not require rewriting prompt.
- step.prompt describes only the task and role duties (persona by job, not by model brand).
- Use step.role for capability identity (e.g. security-reviewer, coding, router). Do not write "You are <model name>".
- To pin a concrete model, set step.model to a provider/model route from the available routes / DSH catalog list only.
- Prefer omitting step.model and relying on role / bias routing unless the user asks to pin a model or assign models from the catalog.
- When a DSH model catalog section is present, NEVER invent provider/model ids; copy routes exactly from that list (or omit step.model).
- When modifying YAML, strip any model/product names already present in prompts; keep duties, move routing to model/role.

Example shape:
apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: example-review
  title: Example Review
spec:
  steps:
    - id: plan
      type: llm
      role: router
      prompt: Plan the work for $PROBLEM
    - id: implement
      type: task
      role: coding
      deps: [plan]
      inputs:
        problem: "$PROBLEM"
      acceptance:
        - Tests pass
    - id: approve
      type: approval
      deps: [implement]
      question: Ship it?
      options: [approved, rejected]
      pass: [approved]
`

/** Strip markdown fences / prose and keep the YAML document body. */
export function extractWorkflowYaml(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const fenced = trimmed.match(/```(?:ya?ml)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const apiIndex = trimmed.search(/^apiVersion:\s*/m)
  if (apiIndex >= 0) return trimmed.slice(apiIndex).trim()
  return trimmed
}

/** Format workflow settings providers for the design user prompt. */
export function formatAvailableModelRoutes(
  routes: readonly DesignModelRoute[],
): string {
  const lines = [
    '## Workflow route preferences (optional shortcuts for step.model, never in prompt)',
  ]
  const usable = routes.filter((entry) => entry.model.includes('/'))
  if (usable.length === 0) {
    lines.push(
      'No workflow preference routes configured.',
    )
    return lines.join('\n')
  }
  for (const entry of usable) {
    const label = entry.id.trim() || entry.model
    lines.push(`- ${label} → ${entry.model}`)
  }
  lines.push(
    'Preference routes must still resolve to real DSH models when a catalog is provided below.',
  )
  return lines.join('\n')
}

/** Format the live DSH LLM catalog for the design user prompt. */
export function formatDshModelCatalog(
  providers: readonly DesignCatalogProvider[],
): string {
  const lines = [
    '## DSH available models (authoritative allow-list for step.model)',
    'When assigning models, copy provider/model exactly from this list. Do not invent ids. Never put these names in prompt text.',
  ]
  let count = 0
  for (const group of providers) {
    if (!group.models.length) continue
    lines.push(`### ${group.name || group.id} (\`${group.id}\`)`)
    for (const model of group.models) {
      if (!model.id) continue
      count += 1
      const label = model.name && model.name !== model.id ? ` — ${model.name}` : ''
      lines.push(`- ${group.id}/${model.id}${label}`)
    }
  }
  if (count === 0) {
    lines.push(
      'No DSH models are currently available. Omit step.model; use step.role only.',
    )
  } else {
    lines.push(
      `Total: ${count} model route(s). If the user asks you to pick suitable models, choose only from this list.`,
    )
  }
  return lines.join('\n')
}

function finishErrorMessage(finish: { kind: string; failure?: { message?: string } }): string | undefined {
  if (finish.kind === 'stop') return undefined
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    return finish.failure?.message ?? `LLM finish: ${finish.kind}`
  }
  if (finish.kind === 'max-tokens') return 'Model output reached maxTokens before completing the YAML'
  return `Unsupported LLM finish: ${finish.kind}`
}

/** Default completion budget for AI workflow design (YAML can be long). */
export const DESIGN_DEFAULT_MAX_TOKENS = 16_384
export const DESIGN_MIN_MAX_TOKENS = 1_024
export const DESIGN_MAX_MAX_TOKENS = 65_536

/** Clamp / default the design maxTokens knobs. */
export function clampDesignMaxTokens(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DESIGN_DEFAULT_MAX_TOKENS
  const rounded = Math.floor(value)
  if (rounded < DESIGN_MIN_MAX_TOKENS) return DESIGN_MIN_MAX_TOKENS
  if (rounded > DESIGN_MAX_MAX_TOKENS) return DESIGN_MAX_MAX_TOKENS
  return rounded
}

/** Parse `provider/model` into stream options; null when invalid. */
export function parseDesignModelRoute(
  route: string | undefined,
): { provider: string; model: string } | null {
  if (typeof route !== 'string') return null
  const trimmed = route.trim()
  const slash = trimmed.indexOf('/')
  if (slash <= 0 || slash >= trimmed.length - 1) return null
  const provider = trimmed.slice(0, slash).trim()
  const model = trimmed.slice(slash + 1).trim()
  if (!provider || !model) return null
  return { provider, model }
}

function resolveDesignRoute(
  services: DesktopWorkflowHostServices,
  override?: string,
): { provider: string; model: string } {
  const explicit = parseDesignModelRoute(override)
  if (explicit) return explicit

  const settings = services.getWorkflowSettings?.()
  if (settings?.providers?.length) {
    const want = (settings.defaultBias || 'coding').toLowerCase()
    const matched = settings.providers.find((entry) => (
      entry.bias.some((tag) => tag.toLowerCase() === want)
      || entry.bias.some((tag) => want.includes(tag.toLowerCase()))
    )) ?? settings.providers[0]
    if (matched?.model.includes('/')) {
      const slash = matched.model.indexOf('/')
      return {
        provider: matched.model.slice(0, slash),
        model: matched.model.slice(slash + 1),
      }
    }
  }
  const selected = services.agentDefaultModel?.currentSelection()
  if (selected?.provider && selected?.model) {
    return { provider: selected.provider, model: selected.model }
  }
  throw new Error(
    'No model available for AI workflow design. Configure workflow providers in Settings, or set a default model.',
  )
}

/** One-shot text generation for workflow design (not a workflow run step). */
export async function runDesignLlm(
  services: DesktopWorkflowHostServices,
  input: {
    system: string
    user: string
    maxTokens?: number
    designModel?: string
    signal?: AbortSignal
  },
): Promise<string> {
  const signal = input.signal ?? new AbortController().signal
  signal.throwIfAborted()
  const route = resolveDesignRoute(services, input.designModel)
  const messages: Message[] = [createUserMessage({
    content: [{ type: 'text', text: input.user }],
    source: { kind: 'plugin', plugin: 'dsh-plugin-desktop/workflow-design' },
  })]
  const options: GenerateOptions = {
    provider: route.provider,
    model: route.model,
    messages,
    system: input.system,
    maxTokens: clampDesignMaxTokens(input.maxTokens),
    signal,
  }
  const assembler = new BlockAssembler()
  for await (const chunk of services.llm.stream(options)) {
    signal.throwIfAborted()
    assembler.push(chunk)
  }
  signal.throwIfAborted()
  const terminal = finishErrorMessage(assembler.finish as { kind: string; failure?: { message?: string } })
  if (terminal) throw new Error(terminal)

  const text = assembler.blocks()
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()
  if (!text) throw new Error('AI design returned an empty response')
  return text
}

/** Build the design LLM user message (exported for unit tests). */
export function buildUserPrompt(
  input: DesignWorkflowInput,
  mode: WorkflowDesignMode,
  modelContext: DesignPromptModelContext = {},
): string {
  const lines = [
    mode === 'modify'
      ? 'Modify the existing workflow according to the design instructions.'
      : 'Create a new workflow according to the design instructions.',
    '',
    '## Design instructions',
    input.prompt.trim(),
  ]

  if (modelContext.catalogProviders) {
    lines.push('', formatDshModelCatalog(modelContext.catalogProviders))
  }

  lines.push('', formatAvailableModelRoutes(modelContext.preferenceRoutes ?? []))

  if (!modelContext.catalogProviders && !(modelContext.preferenceRoutes?.some((r) => r.model.includes('/')))) {
    lines.push(
      '',
      'No model allow-list was injected. Prefer omitting step.model; set step.role and leave routing to bias defaults.',
    )
  }

  if (mode === 'modify' && input.yaml?.trim()) {
    lines.push('', '## Current workflow YAML', input.yaml.trim())
  }
  lines.push('', 'Return only the complete Workflow YAML.')
  return lines.join('\n')
}

/**
 * Generate or revise a workflow YAML via Host LLM, then canonicalize + validate.
 * Does not persist; the client must confirm before saveWorkflow.
 */
export async function designWorkflowWithLlm(
  plugin: WorkflowPlugin,
  hostCtx: Context,
  input: DesignWorkflowInput,
): Promise<DesignWorkflowResult> {
  const prompt = input.prompt?.trim()
  if (!prompt) throw new Error('prompt is required')

  const mode: WorkflowDesignMode = input.mode
    ?? (input.yaml && input.yaml.trim() ? 'modify' : 'create')

  const services = hostServicesFromContext(hostCtx)
  if (!services) throw new Error('host LLM service is unavailable')
  services.getWorkflowSettings = () => plugin.getSettingsSync()

  const settings = plugin.getSettingsSync()
  const preferenceRoutes: DesignModelRoute[] = Array.isArray(settings.providers)
    ? settings.providers.map((entry) => ({ id: entry.id, model: entry.model }))
    : []

  const includeCatalog = input.includeModelCatalog !== false
  let catalogProviders: DesignCatalogProvider[] | undefined
  if (includeCatalog) {
    const catalog = await listWorkflowModelCatalog(hostCtx)
    catalogProviders = catalog.providers.map((group) => ({
      id: group.id,
      name: group.name,
      models: group.models.map((model) => ({ id: model.id, name: model.name })),
    }))
  }

  const raw = await runDesignLlm(services, {
    system: DESIGN_SYSTEM,
    user: buildUserPrompt({ ...input, prompt }, mode, {
      preferenceRoutes,
      ...(catalogProviders ? { catalogProviders } : {}),
    }),
    ...(input.designModel ? { designModel: input.designModel } : {}),
    ...(typeof input.maxTokens === 'number' ? { maxTokens: input.maxTokens } : {}),
  })
  const extracted = extractWorkflowYaml(raw)
  if (!extracted) throw new Error('AI design did not produce YAML')

  let canonical: string
  try {
    canonical = await plugin.canonicalizeYaml(extracted)
  } catch (error) {
    throw new Error(
      `AI design YAML could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const validation = await plugin.validateYaml(canonical)
  return {
    yaml: canonical,
    mode,
    validation: {
      ok: validation.ok,
      errors: validation.errors.map((entry) => ({
        path: entry.path,
        message: entry.message,
        severity: entry.severity,
      })),
    },
  }
}
