import { describe, expect, it } from 'vitest'
import {
  createRun,
  isGatePass,
  resolveGate,
  resolveGatePassDecisions,
  skipUnreachableTasks,
} from '../src/engine/engine.ts'
import {
  StepType,
  TaskStatus,
  validateWorkflow,
  type Workflow,
} from '../src/engine/models.ts'

function approvalWorkflow(pass?: string[]): Workflow {
  return {
    apiVersion: 'workflow-wise/v1',
    kind: 'Workflow',
    metadata: { name: 'gate-demo' },
    spec: {
      steps: [{
        id: 'approve',
        type: StepType.Approval,
        question: 'ok?',
        options: ['approved', 'rejected', 'needs-changes'],
        ...(pass ? { pass } : {}),
      }],
    },
  }
}

describe('gate pass semantics', () => {
  it('defaults pass to approved when listed', () => {
    expect(resolveGatePassDecisions(['approved', 'rejected', 'needs-changes']))
      .toEqual(['approved'])
  })

  it('falls back to the first option when approved is absent', () => {
    expect(resolveGatePassDecisions(['ship-it', 'rework']))
      .toEqual(['ship-it'])
  })

  it('treats needs-changes as failure by default', () => {
    const run = createRun(approvalWorkflow())
    const updated = resolveGate(run, 'approve', 'needs-changes', 'tester', run.gates.approve!.token!)
    expect(updated.tasks.approve?.status).toBe(TaskStatus.Failed)
    expect(isGatePass(run.gates.approve!, 'needs-changes')).toBe(false)
    expect(isGatePass(run.gates.approve!, 'approved')).toBe(true)
  })

  it('honors explicit pass lists', () => {
    const run = createRun(approvalWorkflow(['approved', 'needs-changes']))
    expect(run.gates.approve?.pass).toEqual(['approved', 'needs-changes'])
    const updated = resolveGate(
      run,
      'approve',
      'needs-changes',
      'tester',
      run.gates.approve!.token!,
    )
    expect(updated.tasks.approve?.status).toBe(TaskStatus.Completed)
  })

  it('rejects resolving an already-resolved gate', () => {
    const run = createRun(approvalWorkflow())
    const token = run.gates.approve!.token!
    const once = resolveGate(run, 'approve', 'approved', 'tester', token)
    expect(() => resolveGate(once, 'approve', 'rejected', 'tester', token))
      .toThrow(/already resolved/)
  })

  it('rejects an invalid gate token', () => {
    const run = createRun(approvalWorkflow())
    expect(() => resolveGate(run, 'approve', 'approved', 'tester', 'wrong-token'))
      .toThrow(/Invalid gate token/)
  })

  it('cascades skipUnreachableTasks on a failing decision when workflow is provided', () => {
    const workflow: Workflow = {
      apiVersion: 'workflow-wise/v1',
      kind: 'Workflow',
      metadata: { name: 'gate-cascade' },
      spec: {
        steps: [
          {
            id: 'approve',
            type: StepType.Approval,
            question: 'ok?',
            options: ['approved', 'rejected'],
          },
          {
            id: 'ship',
            type: StepType.Script,
            deps: ['approve'],
            run: 'echo ship',
          },
        ],
      },
    }
    const run = createRun(workflow)
    const token = run.gates.approve!.token!
    const updated = resolveGate(run, 'approve', 'rejected', 'tester', token, { workflow })
    expect(updated.tasks.approve?.status).toBe(TaskStatus.Failed)
    expect(updated.tasks.ship?.status).toBe(TaskStatus.Skipped)
    expect(updated.tasks.ship?.error).toContain('dependency failed')
  })

  it('does not cascade on a passing decision', () => {
    const workflow: Workflow = {
      apiVersion: 'workflow-wise/v1',
      kind: 'Workflow',
      metadata: { name: 'gate-pass-no-cascade' },
      spec: {
        steps: [
          {
            id: 'approve',
            type: StepType.Approval,
            question: 'ok?',
            options: ['approved', 'rejected'],
          },
          {
            id: 'ship',
            type: StepType.Script,
            deps: ['approve'],
            run: 'echo ship',
          },
        ],
      },
    }
    const run = createRun(workflow)
    const token = run.gates.approve!.token!
    const updated = resolveGate(run, 'approve', 'approved', 'tester', token, { workflow })
    expect(updated.tasks.approve?.status).toBe(TaskStatus.Completed)
    expect(updated.tasks.ship?.status).toBe(TaskStatus.Pending)
  })

  it('skipUnreachableTasks after a bare fail decision matches the cascaded result', () => {
    const workflow: Workflow = {
      apiVersion: 'workflow-wise/v1',
      kind: 'Workflow',
      metadata: { name: 'gate-bare-vs-cascade' },
      spec: {
        steps: [
          {
            id: 'approve',
            type: StepType.Approval,
            question: 'ok?',
            options: ['approved', 'rejected'],
          },
          {
            id: 'ship',
            type: StepType.Script,
            deps: ['approve'],
            run: 'echo ship',
          },
        ],
      },
    }
    const run = createRun(workflow)
    const token = run.gates.approve!.token!
    const bare = resolveGate(run, 'approve', 'rejected', 'tester', token)
    const cascaded = resolveGate(run, 'approve', 'rejected', 'tester', token, { workflow })
    const manual = skipUnreachableTasks(bare, workflow)
    expect(manual.tasks.ship?.status).toBe(cascaded.tasks.ship?.status)
  })
})

describe('sub_workflow validation', () => {
  it('requires ref and does not warn about missing execution', () => {
    const result = validateWorkflow({
      apiVersion: 'workflow-wise/v1',
      kind: 'Workflow',
      metadata: { name: 'nested-demo' },
      spec: {
        steps: [{
          id: 'child',
          type: StepType.SubWorkflow,
          ref: 'other',
        }],
      },
    })
    expect(result.ok).toBe(true)
    expect(result.errors.some((e) => e.message.includes('not executed'))).toBe(false)
  })
})
