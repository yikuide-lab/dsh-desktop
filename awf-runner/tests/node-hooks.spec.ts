/**
 * Node LLM hooks: OpenAI-compatible chat-completions mapping for llm/task
 * steps (message shape, max_tokens clamp, error surfaces), plus env config.
 */

import { describe, expect, it } from 'vitest'
import type { ExecutionContext, Step } from 'dsh-plugin-workflow/engine'
import { StepType } from 'dsh-plugin-workflow/engine'
import type { AwfFetch } from '../src/awf/client.js'
import {
  createNodeExecutorHooks,
  nodeLlmConfigFromEnv,
  type NodeLlmConfig,
} from '../src/node/hooks.js'

const CONFIG: NodeLlmConfig = { baseUrl: 'http://llm.test/v1', apiKey: 'k', model: 'test-model' }

function completionFetch(body: unknown, status = 200): { fetchImpl: AwfFetch; calls: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> } {
  const calls: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {},
      auth: (init?.headers as Record<string, string>)?.Authorization ?? null,
    })
    return new Response(JSON.stringify(body), { status })
  }) as AwfFetch
  return { fetchImpl, calls }
}

function context(params: Record<string, unknown> = {}, stepOutputs?: Record<string, unknown>): ExecutionContext {
  return {
    runId: 'run-1',
    workflow: { apiVersion: 'workflow-wise/v1', kind: 'Workflow', metadata: { name: 'wf' }, spec: { steps: [] } },
    stateDir: '/tmp/state',
    params,
    ...(stepOutputs ? { stepOutputs } : {}),
  } as ExecutionContext
}

const llmStep: Step = { id: 'summarize', type: StepType.LLM, prompt: 'Summarize $TOPIC', role: 'reviewer' }
const taskStep: Step = {
  id: 'implement',
  type: StepType.Task,
  prompt: 'Do the work',
  role: 'coder',
  inputs: { repo: 'x' },
  outputs: ['report'],
  acceptance: ['build passes'],
}

describe('nodeLlmConfigFromEnv', () => {
  it('returns null unless base URL and model are set', () => {
    expect(nodeLlmConfigFromEnv({})).toBeNull()
    expect(nodeLlmConfigFromEnv({ AWF_NODE_LLM_BASE_URL: 'http://x/v1' })).toBeNull()
    expect(nodeLlmConfigFromEnv({ AWF_NODE_LLM_MODEL: 'm' })).toBeNull()
  })

  it('normalizes trailing slashes and reads the key', () => {
    expect(nodeLlmConfigFromEnv({
      AWF_NODE_LLM_BASE_URL: 'http://x/v1/',
      AWF_NODE_LLM_API_KEY: ' k ',
      AWF_NODE_LLM_MODEL: 'm',
    })).toEqual({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' })
  })

  it('rejects non-http URLs', () => {
    expect(nodeLlmConfigFromEnv({
      AWF_NODE_LLM_BASE_URL: 'ftp://x',
      AWF_NODE_LLM_MODEL: 'm',
    })).toBeNull()
  })
})

describe('createNodeExecutorHooks', () => {
  it('installs no hooks without config (honest engine failure)', () => {
    expect(createNodeExecutorHooks(null)).toEqual({})
  })

  it('runLlm posts system+user with substituted prompt and returns text', async () => {
    const { fetchImpl, calls } = completionFetch({ choices: [{ message: { content: '  the summary ' } }] })
    const hooks = createNodeExecutorHooks(CONFIG, { fetchImpl })
    const outcome = await hooks.runLlm!(llmStep, context({ topic: 'AWF' }, { fetch: { stdout: 'raw-data' } }), '/tmp', new AbortController().signal)
    expect(outcome.ok).toBe(true)
    expect(outcome.output).toEqual({ text: 'the summary', provider: 'openai-compatible', model: 'test-model' })

    const call = calls[0]!
    expect(call.url).toBe('http://llm.test/v1/chat/completions')
    expect(call.auth).toBe('Bearer k')
    expect(call.body.model).toBe('test-model')
    const messages = call.body.messages as Array<{ role: string; content: string }>
    expect(messages[0]!.role).toBe('system')
    expect(messages[0]!.content).toContain('Role: reviewer')
    expect(messages[1]!.role).toBe('user')
    expect(messages[1]!.content).toContain('Summarize AWF')
    // 上游步骤输出拼入 prompt（与桌面路径一致）
    expect(messages[1]!.content).toContain('## Upstream step outputs')
    expect(messages[1]!.content).toContain('raw-data')
    expect(call.body.max_tokens).toBe(8192)
  })

  it('clamps step maxTokens into [256, 32768]', async () => {
    const { fetchImpl, calls } = completionFetch({ choices: [{ message: { content: 'ok' } }] })
    const hooks = createNodeExecutorHooks(CONFIG, { fetchImpl })
    await hooks.runLlm!({ ...llmStep, maxTokens: 10 }, context(), '/tmp', new AbortController().signal)
    expect(calls[0]!.body.max_tokens).toBe(256)
    await hooks.runLlm!({ ...llmStep, maxTokens: 999_999 }, context(), '/tmp', new AbortController().signal)
    expect(calls[1]!.body.max_tokens).toBe(32_768)
  })

  it('strips the provider prefix from provider/model step routes', async () => {
    const { fetchImpl, calls } = completionFetch({ choices: [{ message: { content: 'ok' } }] })
    const hooks = createNodeExecutorHooks(CONFIG, { fetchImpl })
    await hooks.runLlm!({ ...llmStep, model: 'deepseek/deepseek-chat' }, context(), '/tmp', new AbortController().signal)
    expect(calls[0]!.body.model).toBe('deepseek-chat')
  })

  it('runTask carries acceptance and outputs into the prompt (desktop parity)', async () => {
    const { fetchImpl, calls } = completionFetch({ choices: [{ message: { content: 'done' } }] })
    const hooks = createNodeExecutorHooks(CONFIG, { fetchImpl })
    const outcome = await hooks.runTask!(taskStep, context(), '/workspace', new AbortController().signal)
    expect(outcome.ok).toBe(true)
    expect(outcome.output).toMatchObject({ text: 'done', model: 'test-model', role: 'coder' })

    const user = (calls[0]!.body.messages as Array<{ role: string; content: string }>)[0]!
    expect(user.role).toBe('user')
    expect(user.content).toContain('task step "implement" in workspace /workspace')
    expect(user.content).toContain('- build passes')
    expect(user.content).toContain('Produce these outputs when possible: report')
    expect(user.content).toContain('"repo": "x"')
  })

  it('maps HTTP errors and empty completions to honest failures', async () => {
    const errFetch = completionFetch({ error: { message: 'bad key' } }, 401)
    const hooks = createNodeExecutorHooks(CONFIG, { fetchImpl: errFetch.fetchImpl })
    const failed = await hooks.runLlm!(llmStep, context(), '/tmp', new AbortController().signal)
    expect(failed.ok).toBe(false)
    expect(failed.error).toContain('401')
    expect(failed.error).toContain('bad key')

    const emptyFetch = completionFetch({ choices: [{ message: { content: '  ' } }] })
    const hooks2 = createNodeExecutorHooks(CONFIG, { fetchImpl: emptyFetch.fetchImpl })
    const empty = await hooks2.runLlm!(llmStep, context(), '/tmp', new AbortController().signal)
    expect(empty.ok).toBe(false)
    expect(empty.error).toContain('empty LLM response')
  })
})
