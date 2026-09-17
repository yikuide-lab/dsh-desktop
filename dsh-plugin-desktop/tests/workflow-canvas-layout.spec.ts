import { describe, expect, it } from 'vitest'
import {
  allocateStepId,
  autoLayoutSteps,
  connectSteps,
  createBlankStep,
  disconnectSteps,
  removeStep,
  renameStepId,
  stepsToGraph,
  wouldCreateCycle,
} from '../src/client/workflow-canvas-layout.ts'
import type { WorkflowStepView } from '../src/client/desktop-workflow-api.ts'

describe('workflow canvas layout', () => {
  it('allocates unique step ids', () => {
    const steps: WorkflowStepView[] = [
      createBlankStep('script', 'step-1'),
      createBlankStep('llm', 'step-2'),
    ]
    expect(allocateStepId(steps)).toBe('step-3')
  })

  it('builds edges from deps (source → target)', () => {
    const steps: WorkflowStepView[] = [
      { id: 'a', type: 'script', run: 'echo a' },
      { id: 'b', type: 'script', run: 'echo b', deps: ['a'] },
    ]
    const { edges } = stepsToGraph(steps)
    expect(edges).toEqual([{ id: 'a->b', source: 'a', target: 'b' }])
  })

  it('auto-layouts missing coordinates by dependency depth', () => {
    const steps: WorkflowStepView[] = [
      { id: 'a', type: 'script', run: 'a' },
      { id: 'b', type: 'script', run: 'b', deps: ['a'] },
      { id: 'c', type: 'script', run: 'c', deps: ['b'] },
    ]
    const laid = autoLayoutSteps(steps)
    expect(laid[0]?.ui?.x).toBeLessThan(laid[1]?.ui?.x ?? 0)
    expect(laid[1]?.ui?.x).toBeLessThan(laid[2]?.ui?.x ?? 0)
  })

  it('connects deps and rejects cycles', () => {
    let steps: WorkflowStepView[] = [
      { id: 'a', type: 'script', run: 'a' },
      { id: 'b', type: 'script', run: 'b', deps: ['a'] },
    ]
    expect(wouldCreateCycle(steps, 'b', 'a')).toBe(true)
    expect(connectSteps(steps, 'b', 'a')).toBeNull()

    const connected = connectSteps(
      [
        { id: 'a', type: 'script', run: 'a' },
        { id: 'b', type: 'script', run: 'b' },
      ],
      'a',
      'b',
    )
    expect(connected?.[1]?.deps).toEqual(['a'])
    steps = connected!
    steps = disconnectSteps(steps, 'a', 'b')
    expect(steps[1]?.deps).toBeUndefined()
  })

  it('removes a step and rewrites deps', () => {
    const steps: WorkflowStepView[] = [
      { id: 'a', type: 'script', run: 'a' },
      { id: 'b', type: 'script', run: 'b', deps: ['a'] },
      { id: 'c', type: 'script', run: 'c', deps: ['a', 'b'] },
    ]
    const next = removeStep(steps, 'a')
    expect(next.map((step) => step.id)).toEqual(['b', 'c'])
    expect(next[0]?.deps).toBeUndefined()
    expect(next[1]?.deps).toEqual(['b'])
  })

  it('renames step ids across deps', () => {
    const steps: WorkflowStepView[] = [
      { id: 'a', type: 'script', run: 'a' },
      { id: 'b', type: 'script', run: 'b', deps: ['a'] },
    ]
    const next = renameStepId(steps, 'a', 'alpha')
    expect(next?.[0]?.id).toBe('alpha')
    expect(next?.[1]?.deps).toEqual(['alpha'])
    expect(renameStepId(steps, 'a', 'b')).toBeNull()
  })
})
