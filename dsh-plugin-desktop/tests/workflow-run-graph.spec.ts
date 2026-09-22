import { describe, expect, it } from 'vitest'
import {
  activeEdgeIds,
  buildRunGraph,
  failedEdgeIds,
  focusNodeId,
  formatDuration,
  runStatusClass,
} from '../src/client/workflow-run-graph.ts'
import type { RunStepView, WorkflowStepView } from '../src/client/desktop-workflow-api.ts'

const steps: WorkflowStepView[] = [
  { id: 'a', type: 'script', run: 'echo a' },
  { id: 'b', type: 'script', run: 'echo b', deps: ['a'] },
  { id: 'c', type: 'approval', question: 'ok?', options: ['approved', 'rejected'], deps: ['b'] },
  { id: 'd', type: 'script', run: 'echo d', deps: ['c'] },
]

function runStep(id: string, status: string, extra: Partial<RunStepView> = {}): RunStepView {
  return { id, status, ...extra }
}

describe('runStatusClass', () => {
  it('passes through known statuses', () => {
    expect(runStatusClass('running')).toBe('running')
    expect(runStatusClass('completed')).toBe('completed')
    expect(runStatusClass('failed')).toBe('failed')
    expect(runStatusClass('skipped')).toBe('skipped')
    expect(runStatusClass('aborted')).toBe('aborted')
    expect(runStatusClass('pending')).toBe('pending')
  })

  it('maps unknown statuses to pending', () => {
    expect(runStatusClass('weird')).toBe('pending')
    expect(runStatusClass('')).toBe('pending')
  })

  it('marks an unresolved approval gate as waiting', () => {
    expect(runStatusClass('pending', { hasPendingGate: true })).toBe('waiting')
    expect(runStatusClass('running', { hasPendingGate: true })).toBe('waiting')
    expect(runStatusClass('completed', { hasPendingGate: true })).toBe('completed')
  })
})

describe('buildRunGraph', () => {
  it('merges live status onto designer positions and edges', () => {
    const runSteps = [
      runStep('a', 'completed', { durationMs: 120, attempt: 1 }),
      runStep('b', 'running', { attempt: 2 }),
      runStep('c', 'pending'),
      runStep('d', 'pending'),
    ]
    const { nodes, edges } = buildRunGraph(steps, runSteps)
    expect(nodes).toHaveLength(4)
    expect(edges.map((e) => e.id).sort()).toEqual(['a->b', 'b->c', 'c->d'])

    const a = nodes.find((n) => n.id === 'a')!
    expect(a.data.runStatus).toBe('completed')
    expect(a.data.durationMs).toBe(120)
    expect(a.data.attempts).toBe(1)

    const b = nodes.find((n) => n.id === 'b')!
    expect(b.data.runStatus).toBe('running')
    expect(b.data.attempts).toBe(2)
  })

  it('marks unresolved approval nodes as waiting', () => {
    const runSteps = [
      runStep('a', 'completed'),
      runStep('b', 'completed'),
      runStep('c', 'pending'),
      runStep('d', 'pending'),
    ]
    const { nodes } = buildRunGraph(steps, runSteps, { pendingGateStepIds: new Set(['c']) })
    expect(nodes.find((n) => n.id === 'c')!.data.runStatus).toBe('waiting')
  })

  it('keeps designer-only nodes without live status', () => {
    const { nodes } = buildRunGraph(steps, [runStep('a', 'running')])
    expect(nodes.find((n) => n.id === 'd')!.data.runStatus).toBeUndefined()
  })
})

describe('edge highlighting', () => {
  it('activates edges into a running node from a completed source', () => {
    const runSteps = [
      runStep('a', 'completed'),
      runStep('b', 'running'),
      runStep('c', 'pending'),
      runStep('d', 'pending'),
    ]
    const { nodes, edges } = buildRunGraph(steps, runSteps)
    expect(activeEdgeIds(nodes, edges)).toEqual(['a->b'])
  })

  it('marks edges into a failed node', () => {
    const runSteps = [
      runStep('a', 'completed'),
      runStep('b', 'failed'),
      runStep('c', 'pending'),
      runStep('d', 'pending'),
    ]
    const { nodes, edges } = buildRunGraph(steps, runSteps)
    expect(failedEdgeIds(nodes, edges)).toEqual(['a->b'])
  })

  it('is empty for a not-yet-started run', () => {
    const runSteps = steps.map((s) => runStep(s.id, 'pending'))
    const { nodes, edges } = buildRunGraph(steps, runSteps)
    expect(activeEdgeIds(nodes, edges)).toEqual([])
    expect(failedEdgeIds(nodes, edges)).toEqual([])
  })
})

describe('formatDuration', () => {
  it('formats ms / seconds / minutes', () => {
    expect(formatDuration(0)).toBe('0ms')
    expect(formatDuration(820)).toBe('820ms')
    expect(formatDuration(3400)).toBe('3.4s')
    expect(formatDuration(125_000)).toBe('2m 05s')
  })

  it('returns undefined for missing or invalid input', () => {
    expect(formatDuration(undefined)).toBeUndefined()
    expect(formatDuration(Number.NaN)).toBeUndefined()
    expect(formatDuration(-5)).toBeUndefined()
  })
})

describe('focusNodeId', () => {
  it('prefers the running node, then a waiting gate', () => {
    const running = buildRunGraph(steps, [
      runStep('a', 'completed'),
      runStep('b', 'running'),
      runStep('c', 'pending'),
      runStep('d', 'pending'),
    ])
    expect(focusNodeId(running.nodes)).toBe('b')

    const waiting = buildRunGraph(steps, [
      runStep('a', 'completed'),
      runStep('b', 'completed'),
      runStep('c', 'pending'),
      runStep('d', 'pending'),
    ], { pendingGateStepIds: new Set(['c']) })
    expect(focusNodeId(waiting.nodes)).toBe('c')
  })

  it('returns undefined when nothing is active', () => {
    const { nodes } = buildRunGraph(steps, steps.map((s) => runStep(s.id, 'pending')))
    expect(focusNodeId(nodes)).toBeUndefined()
  })
})
