import { describe, expect, it, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkflowPlugin } from '../src/plugin.ts'
import { WorkflowStatus, TaskStatus } from '../src/engine/models.ts'

describe('sub_workflow nested execution', () => {
  let stateDir: string
  let plugin: WorkflowPlugin

  afterEach(async () => {
    plugin?.stop()
    await plugin?.whenStopped()
    if (stateDir) await rm(stateDir, { recursive: true, force: true })
  })

  async function waitForRun(
    runId: string,
    predicate: (status: string) => boolean,
    timeoutMs = 5000,
  ) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const run = await plugin.getRun(runId)
      if (run && predicate(run.status)) return run
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    throw new Error(`Timed out waiting for run ${runId}`)
  }

  it('runs a child workflow and settles the parent step', async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'dsh-wf-sub-'))
    plugin = new WorkflowPlugin({ stateDir, mcpEnabled: false, tickInterval: 40 })
    await plugin.init()

    await plugin.createWorkflow(`
apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: child-echo
spec:
  steps:
    - id: echo
      type: script
      run: echo nested-ok
`)
    await plugin.createWorkflow(`
apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: parent-nest
spec:
  steps:
    - id: call-child
      type: sub_workflow
      ref: child-echo
`)

    const parent = await plugin.startRun('parent-nest')
    const finished = await waitForRun(parent.id, (status) => status !== WorkflowStatus.Running)
    expect(finished.status).toBe(WorkflowStatus.Completed)
    expect(finished.tasks['call-child']?.status).toBe(TaskStatus.Completed)
    const output = finished.tasks['call-child']?.result as { childRunId?: string } | undefined
    expect(typeof output?.childRunId).toBe('string')
    const child = await plugin.getRun(String(output?.childRunId))
    expect(child?.parentRunId).toBe(parent.id)
    expect(child?.status).toBe(WorkflowStatus.Completed)
  })

  it('rejects circular sub_workflow references', async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'dsh-wf-cycle-'))
    plugin = new WorkflowPlugin({ stateDir, mcpEnabled: false, tickInterval: 40 })
    await plugin.init()

    await plugin.createWorkflow(`
apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: cycle-a
spec:
  steps:
    - id: to-b
      type: sub_workflow
      ref: cycle-b
`)
    await plugin.createWorkflow(`
apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: cycle-b
spec:
  steps:
    - id: to-a
      type: sub_workflow
      ref: cycle-a
`)

    const parent = await plugin.startRun('cycle-a')
    const finished = await waitForRun(parent.id, (status) => status !== WorkflowStatus.Running)
    expect(finished.status).toBe(WorkflowStatus.Failed)
    expect(String(finished.tasks['to-b']?.error ?? '')).toMatch(/Circular sub_workflow/i)
  })

  it('aborts child runs when the parent is stopped', async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'dsh-wf-cascade-'))
    plugin = new WorkflowPlugin({ stateDir, mcpEnabled: false, tickInterval: 40 })
    await plugin.init()

    await plugin.createWorkflow(`
apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: child-sleep
spec:
  steps:
    - id: wait
      type: script
      run: sleep 5
`)
    await plugin.createWorkflow(`
apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: parent-wait
spec:
  steps:
    - id: nest
      type: sub_workflow
      ref: child-sleep
`)

    const parent = await plugin.startRun('parent-wait')
    await new Promise((resolve) => setTimeout(resolve, 120))
    const live = await plugin.listRuns()
    const child = live.find((run) => run.parentRunId === parent.id)
    expect(child).toBeDefined()

    const stopped = await plugin.stopRun(parent.id)
    expect(stopped.status).toBe(WorkflowStatus.Aborted)
    const childAfter = await plugin.getRun(child!.id)
    expect(childAfter?.status).toBe(WorkflowStatus.Aborted)
  })
})
