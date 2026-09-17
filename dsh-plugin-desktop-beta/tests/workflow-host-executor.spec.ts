import { describe, expect, it, vi } from 'vitest'
import { createDesktopWorkflowHostHooks } from '../src/desktop-workflow-executor.ts'
import type { Step } from 'dsh-plugin-workflow/engine'
import { StepType } from 'dsh-plugin-workflow/engine'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'

describe('desktop workflow host hooks', () => {
  it('runs LLM steps through ctx.llm.stream', async () => {
    const stream = vi.fn(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'hello from model' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'hello from model' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    const hooks = createDesktopWorkflowHostHooks({
      llm: { stream },
      agentDefaultModel: {
        currentSelection: () => ({ provider: 'mock', model: 'mock-model' }),
      },
    })
    const step = {
      id: 'summarize',
      type: StepType.LLM,
      prompt: 'Summarize $WORKSPACE_ROOT',
    } as Step
    const outcome = await hooks.runLlm!(step, {
      runId: 'run-1',
      workflow: {} as never,
      stateDir: '.',
      env: { WORKSPACE_ROOT: '/tmp/demo' },
    }, '/tmp/demo', new AbortController().signal)

    expect(outcome.ok).toBe(true)
    expect(outcome.output).toMatchObject({ text: 'hello from model', provider: 'mock', model: 'mock-model' })
    expect(stream).toHaveBeenCalledOnce()
    const options = (
      stream.mock.calls as unknown as Array<[{ messages: Array<{ content: Array<{ text: string }> }> }]>
    )[0]![0]
    expect(options.messages[0]!.content[0]!.text).toContain('/tmp/demo')
  })

  it('fails task steps when agents is unavailable', async () => {
    const hooks = createDesktopWorkflowHostHooks({
      llm: { stream: async function* () { /* empty */ } },
    })
    const outcome = await hooks.runTask!({
      id: 'review',
      type: StepType.Task,
      role: 'review',
    } as Step, {
      runId: 'run-1',
      workflow: {} as never,
      stateDir: '.',
    }, '/tmp/demo', new AbortController().signal)
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toMatch(/ctx\.agents/)
  })
})
