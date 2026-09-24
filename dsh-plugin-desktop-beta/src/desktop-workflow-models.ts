/** Host helpers that expose DSH LLM registry + custom provider creation to the workflow UI. */

import type { Context } from '@deepseek-ai/cordis'
import { supportedProtocols } from '@deepseek-ai/dsh-llm-pi-ai'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-credentials'

const PI_AI_NS = 'llm-pi-ai' as const
const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

export interface WorkflowModelEntryView {
  readonly id: string
  readonly name: string
}

export interface WorkflowProviderGroupView {
  readonly id: string
  readonly name: string
  readonly models: readonly WorkflowModelEntryView[]
}

export interface WorkflowModelCatalogView {
  readonly protocols: readonly string[]
  readonly providers: readonly WorkflowProviderGroupView[]
  readonly defaultRoute?: string
  readonly defaultModel?: string
}

export interface WorkflowCustomProviderInput {
  readonly routeId: string
  readonly displayName?: string
  readonly api: string
  readonly baseURL: string
  readonly apiKey?: string
  readonly modelId: string
  readonly modelName?: string
  readonly contextWindow?: number
  readonly maxTokens?: number
}

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** Derive credential ref the same way the Models settings page does. */
export function deriveWorkflowKeyRef(routeId: string): string {
  return `${routeId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/**
 * The wire protocols a hand-declared route may name. This reads llm-pi-ai's
 * live table — the same one its settings schema validates against — so the
 * picker and the create-path validation can never drift from what the runtime
 * actually accepts.
 */
function readProtocols(): readonly string[] {
  return supportedProtocols()
}

/** Project live LLM routes into a picker-friendly catalog for the workflow UI. */
export async function listWorkflowModelCatalog(ctx: Context): Promise<WorkflowModelCatalogView> {
  const llm = ctx.get('llm') as {
    listProviders(): ReadonlyArray<{ id: string; name: string }>
    listModels(providerId: string): Promise<ReadonlyArray<{ id: string; name?: string }>>
  } | undefined
  if (llm === undefined) {
    return { protocols: readProtocols(), providers: [] }
  }

  const providers = llm.listProviders()
  const groups = await Promise.all(providers.map(async (provider) => {
    try {
      const models = await llm.listModels(provider.id)
      return {
        id: provider.id,
        name: provider.name || provider.id,
        models: models.map(model => ({
          id: model.id,
          name: model.name || model.id,
        })),
      } satisfies WorkflowProviderGroupView
    } catch {
      return {
        id: provider.id,
        name: provider.name || provider.id,
        models: [],
      } satisfies WorkflowProviderGroupView
    }
  }))

  const agentDefault = ctx.get('agentDefaultModel') as {
    currentSelection(): { provider: string; model: string }
  } | undefined
  const selection = agentDefault?.currentSelection()

  return {
    protocols: readProtocols(),
    providers: groups.filter(group => group.models.length > 0),
    ...(selection === undefined ? {} : {
      defaultRoute: selection.provider,
      defaultModel: selection.model,
    }),
  }
}

/**
 * Register a hand-declared OpenAI/Anthropic-compatible gateway into DSH
 * `llm-pi-ai` settings (and optionally credentials), matching Models UI create.
 */
export async function registerWorkflowCustomProvider(
  ctx: Context,
  input: WorkflowCustomProviderInput,
): Promise<{ provider: string; model: string; route: string }> {
  const routeId = input.routeId.trim()
  if (!ROUTE_PATTERN.test(routeId)) {
    throw new Error('route id must match ^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$')
  }
  const baseURL = input.baseURL.trim()
  if (!isHttpUrl(baseURL)) {
    throw new Error('baseURL must be an http(s) URL')
  }
  const api = input.api.trim()
  if (!supportedProtocols().includes(api)) {
    throw new Error(`unsupported protocol: ${api}`)
  }
  const modelId = input.modelId.trim()
  if (modelId.length === 0) {
    throw new Error('modelId is required')
  }

  const settings = ctx.get('settings') as {
    describe(): ReadonlyArray<{ ns: string; revision: number }>
    mutate(
      ns: string,
      ops: ReadonlyArray<{ op: 'set' | 'unset'; path: readonly string[]; value?: unknown }>,
      expectedRevision?: number,
    ): Promise<void>
  } | undefined
  if (settings === undefined) {
    throw new Error('settings service is unavailable')
  }

  const descriptor = settings.describe().find(entry => entry.ns === PI_AI_NS)
  const revision = descriptor?.revision
  const apiKey = input.apiKey?.trim() ?? ''
  const keyRef = deriveWorkflowKeyRef(routeId)
  const profile = {
    ...(input.displayName?.trim() ? { displayName: input.displayName.trim() } : {}),
    ...(apiKey.length > 0 ? { apiKeyEnv: keyRef } : {}),
    api,
    baseURL,
    models: [{
      id: modelId,
      name: input.modelName?.trim() || modelId,
      contextWindow: input.contextWindow && input.contextWindow > 0 ? input.contextWindow : 128_000,
      maxTokens: input.maxTokens && input.maxTokens > 0 ? input.maxTokens : 8_192,
    }],
  }

  await settings.mutate(
    PI_AI_NS,
    [{ op: 'set', path: ['providers', routeId], value: profile }],
    revision,
  )

  if (apiKey.length > 0) {
    const credentials = ctx.get('credentials') as {
      set(ref: string, value: string): Promise<void>
    } | undefined
    if (credentials === undefined) {
      throw new Error('credentials service is unavailable')
    }
    await credentials.set(keyRef, apiKey)
  }

  return {
    provider: routeId,
    model: modelId,
    route: `${routeId}/${modelId}`,
  }
}
