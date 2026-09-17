import { describe, expect, it, vi } from 'vitest'
import {
  deriveWorkflowKeyRef,
  listWorkflowModelCatalog,
  registerWorkflowCustomProvider,
} from '../src/desktop-workflow-models.ts'

describe('workflow model catalog helpers', () => {
  it('derives credential refs like Models settings', () => {
    expect(deriveWorkflowKeyRef('anthropic')).toBe('ANTHROPIC_API_KEY')
    expect(deriveWorkflowKeyRef('minimax-cn')).toBe('MINIMAX_CN_API_KEY')
  })

  it('lists providers and models from the host llm service', async () => {
    const ctx = {
      settings: { describe: () => [] },
      get(name: string) {
        if (name === 'llm') {
          return {
            listProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }],
            listModels: async () => [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
          }
        }
        if (name === 'agentDefaultModel') {
          return { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) }
        }
        return undefined
      },
    }
    const catalog = await listWorkflowModelCatalog(ctx as never)
    expect(catalog.providers).toEqual([{
      id: 'deepseek',
      name: 'DeepSeek',
      models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
    }])
    expect(catalog.defaultRoute).toBe('deepseek')
    expect(catalog.defaultModel).toBe('deepseek-chat')
  })

  it('registers a custom llm-pi-ai provider and optional credential', async () => {
    const mutate = vi.fn(async () => undefined)
    const setCredential = vi.fn(async () => undefined)
    const ctx = {
      get(name: string) {
        if (name === 'settings') {
          return {
            describe: () => [{ ns: 'llm-pi-ai', revision: 3 }],
            mutate,
          }
        }
        if (name === 'credentials') {
          return { set: setCredential }
        }
        return undefined
      },
    }

    const result = await registerWorkflowCustomProvider(ctx as never, {
      routeId: 'acme-gateway',
      displayName: 'Acme',
      api: 'openai-completions',
      baseURL: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      modelId: 'gpt-4.1',
    })

    expect(result).toEqual({
      provider: 'acme-gateway',
      model: 'gpt-4.1',
      route: 'acme-gateway/gpt-4.1',
    })
    expect(mutate).toHaveBeenCalledWith(
      'llm-pi-ai',
      [{
        op: 'set',
        path: ['providers', 'acme-gateway'],
        value: {
          displayName: 'Acme',
          apiKeyEnv: 'ACME_GATEWAY_API_KEY',
          api: 'openai-completions',
          baseURL: 'https://api.example.com/v1',
          models: [{
            id: 'gpt-4.1',
            name: 'gpt-4.1',
            contextWindow: 128_000,
            maxTokens: 8_192,
          }],
        },
      }],
      3,
    )
    expect(setCredential).toHaveBeenCalledWith('ACME_GATEWAY_API_KEY', 'sk-test')
  })

  it('rejects invalid custom provider input', async () => {
    await expect(registerWorkflowCustomProvider({ get: () => undefined } as never, {
      routeId: 'Bad Id',
      api: 'openai-completions',
      baseURL: 'https://api.example.com/v1',
      modelId: 'm',
    })).rejects.toThrow(/route id/)

    await expect(registerWorkflowCustomProvider({ get: () => undefined } as never, {
      routeId: 'ok',
      api: 'openai-completions',
      baseURL: 'not-a-url',
      modelId: 'm',
    })).rejects.toThrow(/baseURL/)
  })
})
