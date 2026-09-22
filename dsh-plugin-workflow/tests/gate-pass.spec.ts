import { describe, expect, it } from 'vitest'
import {
  createRun,
  isGatePass,
  resolveGate,
  resolveGatePassDecisions,
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
