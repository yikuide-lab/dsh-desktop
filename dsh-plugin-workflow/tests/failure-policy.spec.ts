import { describe, expect, it } from 'vitest'
import {
  createRun,
  settleDispatch,
  computeReady,
  skipUnreachableTasks,
  DEFAULT_FAILURE_POLICY,
} from '../src/engine/engine.js'
import {
  DispatchStatus,
  StepType,
  TaskStatus,
  type Workflow,
} from '../src/engine/models.js'

function makeWorkflow(steps: Workflow['spec']['steps']): Workflow {
  return {
    apiVersion: 'workflow-wise/v1',
    kind: 'Workflow',
    metadata: { name: 'failure-policy-test' },
    spec: { steps },
  }
}

function seedFailedDispatch(run: ReturnType<typeof createRun>, stepId: string, count: number) {
  const task = run.tasks[stepId]!
  const dispatches = Array.from({ length: count }, (_, index) => ({
    id: `d-${index}`,
    stepId,
    status: DispatchStatus.Failed,
    attempt: index + 1,
    phase: 'execute' as const,
  }))
  return {
    ...run,
    tasks: {
      ...run.tasks,
      [stepId]: {
        ...task,
        status: TaskStatus.InProgress,
        dispatches: [
          ...dispatches,
          {
            id: 'd-current',
            stepId,
            status: DispatchStatus.Running,
            attempt: count + 1,
            phase: 'execute' as const,
          },
        ],
      },
    },
  }
}

describe('failure policy', () => {
  it('retries until defaultRetries+1 failures then fails', () => {
    const workflow = makeWorkflow([
      { id: 'a', type: StepType.Script, run: 'false' },
    ])
    let run = createRun(workflow)
    // defaultRetries=2 → 3 attempts; seed 2 prior failures + current
    run = seedFailedDispatch(run, 'a', 2)
    const settled = settleDispatch(run, 'd-current', { success: false, error: 'boom' }, {
      workflow,
      defaults: DEFAULT_FAILURE_POLICY,
    })
    expect(settled.run.tasks.a?.status).toBe(TaskStatus.Failed)
    expect(settled.pendingCompensation).toBeUndefined()
  })

  it('respects per-step retries=0 (failback on first failure)', () => {
    const workflow = makeWorkflow([
      { id: 'a', type: StepType.Script, run: 'false', retries: 0, on_failure: 'skip' },
    ])
    let run = createRun(workflow)
    run = seedFailedDispatch(run, 'a', 0)
    const settled = settleDispatch(run, 'd-current', { success: false, error: 'boom' }, {
      workflow,
      defaults: DEFAULT_FAILURE_POLICY,
    })
    expect(settled.run.tasks.a?.status).toBe(TaskStatus.Skipped)
  })

  it('skip failback unblocks dependents', () => {
    const workflow = makeWorkflow([
      { id: 'a', type: StepType.Script, run: 'false', retries: 0, on_failure: 'skip' },
      { id: 'b', type: StepType.Script, run: 'true', deps: ['a'] },
    ])
    let run = createRun(workflow)
    run = seedFailedDispatch(run, 'a', 0)
    const settled = settleDispatch(run, 'd-current', { success: false, error: 'boom' }, {
      workflow,
    })
    expect(settled.run.tasks.a?.status).toBe(TaskStatus.Skipped)
    expect(computeReady(settled.run, workflow)).toContain('b')
  })

  it('fail failback skips unreachable dependents', () => {
    const workflow = makeWorkflow([
      { id: 'a', type: StepType.Script, run: 'false', retries: 0, on_failure: 'fail' },
      { id: 'b', type: StepType.Script, run: 'true', deps: ['a'] },
    ])
    let run = createRun(workflow)
    run = seedFailedDispatch(run, 'a', 0)
    const settled = settleDispatch(run, 'd-current', { success: false, error: 'boom' }, {
      workflow,
    })
    expect(settled.run.tasks.a?.status).toBe(TaskStatus.Failed)
    expect(settled.run.tasks.b?.status).toBe(TaskStatus.Skipped)
  })

  it('compensate requests pending compensation', () => {
    const workflow = makeWorkflow([
      {
        id: 'a',
        type: StepType.Script,
        run: 'false',
        retries: 0,
        on_failure: 'compensate',
        compensation: { run: 'echo cleanup' },
      },
    ])
    let run = createRun(workflow)
    run = seedFailedDispatch(run, 'a', 0)
    const settled = settleDispatch(run, 'd-current', { success: false, error: 'boom' }, {
      workflow,
    })
    expect(settled.run.tasks.a?.status).toBe(TaskStatus.InProgress)
    expect(settled.pendingCompensation?.compensation.run).toBe('echo cleanup')
  })

  it('skipUnreachableTasks is idempotent for already skipped trees', () => {
    const workflow = makeWorkflow([
      { id: 'a', type: StepType.Script, run: 'false' },
      { id: 'b', type: StepType.Script, run: 'true', deps: ['a'] },
    ])
    let run = createRun(workflow)
    run = {
      ...run,
      tasks: {
        ...run.tasks,
        a: { ...run.tasks.a!, status: TaskStatus.Failed, completedAt: new Date().toISOString() },
      },
    }
    const once = skipUnreachableTasks(run, workflow)
    const twice = skipUnreachableTasks(once, workflow)
    expect(once.tasks.b?.status).toBe(TaskStatus.Skipped)
    expect(twice.tasks.b?.status).toBe(TaskStatus.Skipped)
  })
})
