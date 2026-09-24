import { describe, expect, it, vi } from 'vitest'
import { createDesktopWorkflowHostHooks } from '../src/desktop-workflow-executor.ts'
import type { RsiReviewRequest } from 'dsh-plugin-workflow/engine'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

const REQUEST: RsiReviewRequest = {
  problemId: 3,
  title: 'Summaries',
  domain: 'summarization',
  improvementCriteria: 'be concise',
  iterationNumber: 0,
  yaml: 'base: v0',
}

function jsonStream(body: string) {
  return vi.fn(async function* (): AsyncGenerator<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: body }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: body } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
}

describe('desktop RSI review', () => {
  it('runs one review pass through ctx.llm.stream and parses the verdict', async () => {
    const verdict = JSON.stringify({ score: 81, feedback: 'tighter steps', improvedYaml: 'base: v1' })
    const stream = jsonStream(verdict)
    const hooks = createDesktopWorkflowHostHooks({
      llm: { stream },
      agentDefaultModel: {
        currentSelection: () => ({ provider: 'mock', model: 'mock-model' }),
      },
    })
    const result = await hooks.runRsiReview!(REQUEST)
    expect(result).toEqual({ score: 81, feedback: 'tighter steps', improvedYaml: 'base: v1' })
    expect(stream).toHaveBeenCalledOnce()

    const options = (stream.mock.calls as unknown as Array<[GenerateOptions]>)[0]![0]
    expect(options.provider).toBe('mock')
    expect(options.model).toBe('mock-model')
    expect(options.system).toContain('JSON')
    const user = options.messages[0]!.content[0] as { type: 'text'; text: string }
    expect(user.text).toContain('Summaries')
    expect(user.text).toContain('be concise')
    expect(user.text).toContain('base: v0')
  })

  it('prefers a review-biased workflow provider route', async () => {
    const stream = jsonStream(JSON.stringify({ score: 60, feedback: 'ok', improvedYaml: 'base: v1' }))
    const hooks = createDesktopWorkflowHostHooks({
      llm: { stream },
      agentDefaultModel: {
        currentSelection: () => ({ provider: 'fallback', model: 'fb' }),
      },
      getWorkflowSettings: () => ({
        providers: [
          { id: 'coder', model: 'prov/code-model', bias: ['coding'] },
          { id: 'critic', model: 'prov/review-model', bias: ['review'] },
        ],
        defaultBias: 'coding',
        defaultRetries: 0,
        defaultOnFailure: 'fail' as const,
      }),
    })
    await hooks.runRsiReview!(REQUEST)
    const options = (stream.mock.calls as unknown as Array<[GenerateOptions]>)[0]![0]
    expect(options.provider).toBe('prov')
    expect(options.model).toBe('review-model')
  })
})
