/**
 * Headless workflow executor hooks backed by a plain OpenAI-compatible
 * chat-completions endpoint.
 *
 * Configuration comes from the environment:
 *   AWF_NODE_LLM_BASE_URL  e.g. https://api.openai.com/v1 (or any compatible)
 *   AWF_NODE_LLM_API_KEY   Bearer key (optional for local endpoints)
 *   AWF_NODE_LLM_MODEL     default model for steps that don't pin one
 *   AWF_NODE_LLM_API       wire protocol: openai-completions (default),
 *                          openai-responses, or anthropic-messages
 *
 * Semantics: `llm` steps map to a single system+user completion (same prompts
 * as the desktop Host executor). `task` steps collapse the desktop agent
 * session (create + followup + whenIdle) into one completion call — there is
 * no tool-using agent loop on a headless node; acceptance criteria, inputs,
 * and requested outputs are carried in the prompt exactly like the desktop
 * path. Without a configured endpoint no hooks are installed and llm/task
 * steps fail honestly with the engine's built-in error.
 */

import {
  buildRsiReviewPrompt,
  parseRsiReviewResponse,
  RSI_REVIEW_MAX_TOKENS,
  type DesktopExecutorHooks,
  type RsiReviewRequest,
  type RsiReviewResult,
  type StepOutcome,
} from 'dsh-plugin-workflow/engine'
import type { AwfFetch } from '../awf/client.js'
import {
  buildLlmPrompt,
  buildLlmSystemPrompt,
  buildTaskPrompt,
  resolveLlmMaxTokens,
} from './prompt.js'

/** Wire protocols a headless runner may speak; names match llm-pi-ai's table. */
export type NodeLlmApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages'

export interface NodeLlmConfig {
  readonly baseUrl: string
  readonly apiKey: string
  readonly model: string
  readonly api: NodeLlmApi
}

export const NODE_LLM_BASE_URL_ENV = 'AWF_NODE_LLM_BASE_URL'
export const NODE_LLM_API_KEY_ENV = 'AWF_NODE_LLM_API_KEY'
export const NODE_LLM_MODEL_ENV = 'AWF_NODE_LLM_MODEL'
export const NODE_LLM_API_ENV = 'AWF_NODE_LLM_API'

/** Read the LLM endpoint config from env; null when not configured. */
export function nodeLlmConfigFromEnv(env: Record<string, string | undefined> = process.env): NodeLlmConfig | null {
  const baseUrl = env[NODE_LLM_BASE_URL_ENV]?.trim()
  const model = env[NODE_LLM_MODEL_ENV]?.trim()
  if (!baseUrl || !model) return null
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  const api = (env[NODE_LLM_API_ENV]?.trim() || 'openai-completions') as NodeLlmApi
  if (api !== 'openai-completions' && api !== 'openai-responses' && api !== 'anthropic-messages') return null
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey: env[NODE_LLM_API_KEY_ENV]?.trim() ?? '',
    model,
    api,
  }
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>
  error?: { message?: unknown }
}

interface ResponsesCompletionResponse {
  output_text?: unknown
  output?: Array<{ content?: Array<{ text?: unknown }> }>
  error?: { message?: unknown }
}

interface AnthropicCompletionResponse {
  content?: Array<{ text?: unknown }>
  error?: { message?: unknown }
}

/** Shared non-streaming completion request shape across wire protocols. */
export interface NodeCompletionRequest {
  system?: string
  user: string
  maxTokens: number
  model?: string
}

async function postCompletion<T extends { error?: { message?: unknown } }>(
  config: NodeLlmConfig,
  path: string,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string>,
  signal: AbortSignal,
  fetchImpl: AwfFetch,
): Promise<T> {
  let response: Response
  try {
    response = await fetchImpl(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (signal.aborted) throw new Error('aborted')
    throw new Error(`LLM endpoint unreachable (${config.baseUrl}): ${error instanceof Error ? error.message : String(error)}`)
  }

  const text = await response.text()
  let payload: T = {} as T
  try {
    payload = text ? (JSON.parse(text) as T) : ({} as T)
  } catch {
    payload = {} as T
  }
  if (!response.ok) {
    const detail = typeof payload.error?.message === 'string'
      ? payload.error.message
      : text.slice(0, 500) || `HTTP ${response.status}`
    throw new Error(`LLM completion failed (HTTP ${response.status}): ${detail}`)
  }
  return payload
}

/** One non-streaming OpenAI chat-completions call; resolves to the assistant text. */
export async function chatCompletion(
  config: NodeLlmConfig,
  request: NodeCompletionRequest,
  signal: AbortSignal,
  fetchImpl: AwfFetch = fetch,
): Promise<{ text: string; model: string }> {
  const model = request.model?.trim() || config.model
  const messages: Array<{ role: string; content: string }> = []
  if (request.system) messages.push({ role: 'system', content: request.system })
  messages.push({ role: 'user', content: request.user })
  const payload = await postCompletion<ChatCompletionResponse>(
    config,
    '/chat/completions',
    { model, messages, max_tokens: request.maxTokens, stream: false },
    {},
    signal,
    fetchImpl,
  )
  const content = payload.choices?.[0]?.message?.content
  const out = typeof content === 'string' ? content.trim() : ''
  if (!out) throw new Error('workflow executor: empty LLM response')
  return { text: out, model }
}

/** One non-streaming OpenAI Responses call; resolves to the assistant text. */
export async function responsesCompletion(
  config: NodeLlmConfig,
  request: NodeCompletionRequest,
  signal: AbortSignal,
  fetchImpl: AwfFetch = fetch,
): Promise<{ text: string; model: string }> {
  const model = request.model?.trim() || config.model
  const payload = await postCompletion<ResponsesCompletionResponse>(
    config,
    '/responses',
    {
      model,
      input: [{ role: 'user', content: [{ type: 'input_text', text: request.user }] }],
      ...(request.system ? { instructions: request.system } : {}),
      max_output_tokens: request.maxTokens,
      stream: false,
    },
    {},
    signal,
    fetchImpl,
  )
  const direct = typeof payload.output_text === 'string' ? payload.output_text.trim() : ''
  const nested = (payload.output ?? [])
    .flatMap(item => item.content ?? [])
    .map(block => (typeof block.text === 'string' ? block.text : ''))
    .join('')
    .trim()
  const out = direct || nested
  if (!out) throw new Error('workflow executor: empty LLM response')
  return { text: out, model }
}

/** One non-streaming Anthropic Messages call; resolves to the assistant text. */
export async function anthropicCompletion(
  config: NodeLlmConfig,
  request: NodeCompletionRequest,
  signal: AbortSignal,
  fetchImpl: AwfFetch = fetch,
): Promise<{ text: string; model: string }> {
  const model = request.model?.trim() || config.model
  const payload = await postCompletion<AnthropicCompletionResponse>(
    config,
    '/messages',
    {
      model,
      max_tokens: request.maxTokens,
      ...(request.system ? { system: request.system } : {}),
      messages: [{ role: 'user', content: request.user }],
      stream: false,
    },
    {
      // Anthropic-native key header plus Bearer covers OpenCode Zen-style gateways.
      ...(config.apiKey ? { 'x-api-key': config.apiKey } : {}),
      'anthropic-version': '2023-06-01',
    },
    signal,
    fetchImpl,
  )
  const out = (payload.content ?? [])
    .map(block => (typeof block.text === 'string' ? block.text : ''))
    .join('')
    .trim()
  if (!out) throw new Error('workflow executor: empty LLM response')
  return { text: out, model }
}

/** Dispatch one completion over the configured wire protocol. */
export function llmCompletion(
  config: NodeLlmConfig,
  request: NodeCompletionRequest,
  signal: AbortSignal,
  fetchImpl: AwfFetch = fetch,
): Promise<{ text: string; model: string }> {
  switch (config.api) {
    case 'openai-responses':
      return responsesCompletion(config, request, signal, fetchImpl)
    case 'anthropic-messages':
      return anthropicCompletion(config, request, signal, fetchImpl)
    default:
      return chatCompletion(config, request, signal, fetchImpl)
  }
}

async function guardOutcome(run: () => Promise<{ text: string; model: string }>, build: (text: string, model: string) => StepOutcome): Promise<StepOutcome> {
  try {
    const { text, model } = await run()
    return build(text, model)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Desktop steps pin `provider/model` routes; on a node only the model part applies. */
function stepModel(stepModelRoute: unknown): string | undefined {
  if (typeof stepModelRoute !== 'string' || !stepModelRoute.trim()) return undefined
  const route = stepModelRoute.trim()
  const slash = route.indexOf('/')
  return slash >= 0 ? route.slice(slash + 1) : route
}

/**
 * Build DesktopExecutorHooks for a headless node. Returns {} when no endpoint
 * is configured so the engine fails llm/task steps with its honest default.
 */
export function createNodeExecutorHooks(
  config: NodeLlmConfig | null,
  options: { fetchImpl?: AwfFetch } = {},
): DesktopExecutorHooks {
  if (!config) return {}
  const doFetch = options.fetchImpl ?? fetch
  return {
    runLlm: (step, context, _cwd, signal) => {
      if (signal.aborted) return Promise.resolve({ ok: false, error: 'aborted' })
      if (!step.prompt) return Promise.resolve({ ok: false, error: 'LLM step missing prompt' })
      return guardOutcome(
        () => llmCompletion(config, {
          system: buildLlmSystemPrompt(step),
          user: buildLlmPrompt(step, context),
          maxTokens: resolveLlmMaxTokens(step),
          ...(stepModel(step.model) ? { model: stepModel(step.model)! } : {}),
        }, signal, doFetch),
        (text, model) => ({ ok: true, output: { text, provider: 'openai-compatible', model } }),
      )
    },
    runTask: (step, context, cwd, signal) => {
      if (signal.aborted) return Promise.resolve({ ok: false, error: 'aborted' })
      return guardOutcome(
        () => llmCompletion(config, {
          user: buildTaskPrompt(step, context, cwd),
          maxTokens: resolveLlmMaxTokens(step),
          ...(stepModel(step.model) ? { model: stepModel(step.model)! } : {}),
        }, signal, doFetch),
        (text, model) => ({
          ok: true,
          output: {
            text,
            model,
            ...(step.role ? { role: step.role } : {}),
          },
        }),
      )
    },
    runRsiReview: (request: RsiReviewRequest, signal?: AbortSignal): Promise<RsiReviewResult> => {
      const prompt = buildRsiReviewPrompt(request)
      return llmCompletion(config, {
        system: prompt.system,
        user: prompt.user,
        maxTokens: RSI_REVIEW_MAX_TOKENS,
      }, signal ?? new AbortController().signal, doFetch)
        .then(({ text }) => parseRsiReviewResponse(text, request.yaml))
    },
  }
}
