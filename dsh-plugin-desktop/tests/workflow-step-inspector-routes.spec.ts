import { describe, expect, it } from 'vitest'
import { collectLlmModelRoutes } from '../src/client/WorkflowStepInspector.tsx'

describe('collectLlmModelRoutes', () => {
  it('lists workflow prefs and catalog routes without duplicates', () => {
    const result = collectLlmModelRoutes(
      [
        { id: 'coder', model: 'openai/gpt-4o', bias: ['coding'] },
        { id: 'dup', model: 'openai/gpt-4o', bias: [] },
      ],
      [
        {
          id: 'openai',
          name: 'OpenAI',
          models: [
            { id: 'gpt-4o', name: 'GPT-4o' },
            { id: 'o3-mini', name: 'o3-mini' },
          ],
        },
      ],
    )

    expect(result.prefs).toEqual([
      { value: 'openai/gpt-4o', label: 'coder — openai/gpt-4o' },
    ])
    expect(result.catalog).toEqual([
      { value: 'openai/o3-mini', label: 'OpenAI / o3-mini' },
    ])
    expect(result.orphan).toBeNull()
  })

  it('preserves an orphan current route', () => {
    const result = collectLlmModelRoutes(
      [],
      [],
      'custom/my-model',
    )
    expect(result.orphan).toBe('custom/my-model')
  })
})
