import { describe, expect, it } from 'vitest'
import {
  DESIGN_DEFAULT_MAX_TOKENS,
  DESIGN_SYSTEM,
  buildUserPrompt,
  clampDesignMaxTokens,
  extractWorkflowYaml,
  formatAvailableModelRoutes,
  formatDshModelCatalog,
  parseDesignModelRoute,
} from '../src/desktop-workflow-design.ts'

describe('extractWorkflowYaml', () => {
  it('strips markdown fences', () => {
    const raw = 'Here you go:\n```yaml\napiVersion: workflow-wise/v1\nkind: Workflow\n```\n'
    expect(extractWorkflowYaml(raw)).toBe('apiVersion: workflow-wise/v1\nkind: Workflow')
  })

  it('keeps bare yaml starting at apiVersion', () => {
    const raw = 'note\napiVersion: workflow-wise/v1\nkind: Workflow\n'
    expect(extractWorkflowYaml(raw)).toBe('apiVersion: workflow-wise/v1\nkind: Workflow')
  })
})

describe('DESIGN_SYSTEM model/prompt decoupling', () => {
  it('forbids embedding model ids in prompt and pins routes on step.model', () => {
    expect(DESIGN_SYSTEM).toMatch(/NEVER put provider ids, model ids/i)
    expect(DESIGN_SYSTEM).toMatch(/step\.model/i)
    expect(DESIGN_SYSTEM).toMatch(/never in prompt|never.*prompt/i)
    expect(DESIGN_SYSTEM).toMatch(/NEVER invent provider\/model ids/i)
  })
})

describe('formatAvailableModelRoutes', () => {
  it('lists configured preference routes for step.model only', () => {
    const text = formatAvailableModelRoutes([
      { id: 'coder', model: 'openai/gpt-4o' },
      { id: 'skip', model: 'no-slash' },
    ])
    expect(text).toContain('Workflow route preferences')
    expect(text).toContain('coder → openai/gpt-4o')
    expect(text).not.toContain('skip →')
  })

  it('notes when no preference routes exist', () => {
    const text = formatAvailableModelRoutes([])
    expect(text).toContain('No workflow preference routes configured')
  })
})

describe('formatDshModelCatalog', () => {
  it('lists authoritative provider/model allow-list', () => {
    const text = formatDshModelCatalog([
      {
        id: 'openai',
        name: 'OpenAI',
        models: [
          { id: 'gpt-4o', name: 'GPT-4o' },
          { id: 'o3-mini', name: 'o3-mini' },
        ],
      },
    ])
    expect(text).toContain('DSH available models (authoritative allow-list')
    expect(text).toContain('openai/gpt-4o')
    expect(text).toContain('openai/o3-mini')
    expect(text).toContain('Total: 2 model route')
    expect(text).toContain('Do not invent ids')
  })

  it('handles empty catalog', () => {
    const text = formatDshModelCatalog([])
    expect(text).toContain('No DSH models are currently available')
  })
})

describe('buildUserPrompt', () => {
  it('injects preference routes', () => {
    const user = buildUserPrompt(
      { prompt: 'Build a review pipeline' },
      'create',
      { preferenceRoutes: [{ id: 'reviewer', model: 'anthropic/claude-sonnet' }] },
    )
    expect(user).toContain('## Design instructions')
    expect(user).toContain('Build a review pipeline')
    expect(user).toContain('reviewer → anthropic/claude-sonnet')
  })

  it('injects DSH catalog allow-list when provided', () => {
    const user = buildUserPrompt(
      { prompt: 'Pick suitable models for parallel review' },
      'create',
      {
        preferenceRoutes: [],
        catalogProviders: [
          {
            id: 'deepseek',
            name: 'DeepSeek',
            models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
          },
        ],
      },
    )
    expect(user).toContain('DSH available models')
    expect(user).toContain('deepseek/deepseek-chat')
    expect(user).toContain('choose only from this list')
  })

  it('includes current yaml when modifying', () => {
    const user = buildUserPrompt(
      { prompt: 'Add an approval step', yaml: 'apiVersion: workflow-wise/v1\nkind: Workflow' },
      'modify',
      {},
    )
    expect(user).toContain('## Current workflow YAML')
    expect(user).toContain('apiVersion: workflow-wise/v1')
    expect(user).toContain('No model allow-list was injected')
  })
})

describe('parseDesignModelRoute', () => {
  it('parses provider/model routes', () => {
    expect(parseDesignModelRoute('openai/gpt-4o')).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
    })
    expect(parseDesignModelRoute('  anthropic/claude-sonnet-4  ')).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4',
    })
  })

  it('rejects invalid routes', () => {
    expect(parseDesignModelRoute('')).toBeNull()
    expect(parseDesignModelRoute('noslash')).toBeNull()
    expect(parseDesignModelRoute('/only-model')).toBeNull()
    expect(parseDesignModelRoute('provider/')).toBeNull()
  })
})

describe('clampDesignMaxTokens', () => {
  it('defaults and clamps', () => {
    expect(clampDesignMaxTokens(undefined)).toBe(DESIGN_DEFAULT_MAX_TOKENS)
    expect(clampDesignMaxTokens(Number.NaN)).toBe(DESIGN_DEFAULT_MAX_TOKENS)
    expect(clampDesignMaxTokens(100)).toBe(1_024)
    expect(clampDesignMaxTokens(20_000)).toBe(20_000)
    expect(clampDesignMaxTokens(999_999)).toBe(65_536)
  })
})
