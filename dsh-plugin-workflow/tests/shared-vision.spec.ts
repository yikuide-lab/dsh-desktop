import { describe, expect, it } from 'vitest'
import { extractSharedPatch, mergeSharedVision } from '../src/engine/shared-vision.ts'
import { Coordinator } from '../src/engine/coordinator.ts'
import { DispatchStatus, StepType, WorkflowStatus, type Workflow, type Run } from '../src/engine/models.ts'

describe('shared vision', () => {
  it('extracts shared objects and router JSON from llm text', () => {
    expect(extractSharedPatch({ shared: { goal: 'x' } })).toEqual({ goal: 'x' })
    expect(extractSharedPatch({ vision_append: 'note' })).toEqual({ vision_append: 'note' })
    const fromText = extractSharedPatch({
      text: '```json\n{"match":null,"plan":[{"id":"a","role":"implement","goal":"g"}],"rationale":"r"}\n```',
    })
    expect(fromText).toEqual({
      router: {
        match: null,
        plan: [{ id: 'a', role: 'implement', goal: 'g' }],
        rationale: 'r',
      },
    })
  })

  it('merges vision_append while shallow-merging other keys', () => {
    const merged = mergeSharedVision(
      { goal: 'old', vision_append: 'a' },
      { goal: 'new', vision_append: 'b', plan: [1] },
    )
    expect(merged.goal).toBe('new')
    expect(merged.plan).toEqual([1])
    expect(merged.vision_append).toBe('a\n\nb')
  })

  it('restores shared blackboard on coordinator resume', async () => {
    const workflow: Workflow = {
      apiVersion: 'workflow-wise/v1',
      kind: 'Workflow',
      metadata: { name: 'resume-demo' },
      spec: { steps: [{ id: 'a', type: StepType.Script, run: 'echo a' }] },
    }
    const run: Run = {
      id: 'run-1',
      workflowName: 'resume-demo',
      status: WorkflowStatus.Running,
      tasks: {},
      gates: {},
      startedAt: new Date().toISOString(),
      shared: { goal: 'persisted' },
    }
    const coordinator = new Coordinator({ tickInterval: 10_000 })
    const executor = {
      submit: async () => undefined,
      poll: async (id: string) => ({
        id,
        stepId: 'a',
        status: DispatchStatus.Succeeded,
        attempt: 1,
      }),
      abort: async () => undefined,
    }
    await coordinator.resume(workflow, run, executor)
    expect(coordinator.getRun()?.shared).toEqual({ goal: 'persisted' })
  })
})
