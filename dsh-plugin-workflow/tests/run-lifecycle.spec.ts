import { describe, expect, it, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkflowPlugin } from '../src/plugin.ts'
import { WorkflowStatus, TaskStatus } from '../src/engine/models.ts'

describe('workflow plugin run lifecycle', () => {
  let stateDir: string
  let plugin: WorkflowPlugin

  afterEach(async () => {
    plugin?.stop()
    await plugin?.whenStopped()
    if (stateDir) await rm(stateDir, { recursive: true, force: true })
  })

  it('allows concurrent runs up to maxActiveRuns and stop aborts in-flight work', async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'dsh-wf-active-'))
    plugin = new WorkflowPlugin({
      stateDir,
      mcpEnabled: false,
      tickInterval: 40,
      maxActiveRuns: 2,
    })
    await plugin.init()

    const yaml = `
apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: sleep-demo
spec:
  steps:
    - id: wait
      type: script
      run: sleep 5
`
    const saved = await plugin.createWorkflow(yaml)
    expect(saved.validation.ok).toBe(true)

    const first = await plugin.startRun('sleep-demo')
    expect(first.status).toBe(WorkflowStatus.Running)

    await new Promise((resolve) => setTimeout(resolve, 120))

    const second = await plugin.startRun('sleep-demo')
    expect(second.status).toBe(WorkflowStatus.Running)
    expect(second.id).not.toBe(first.id)

    await expect(plugin.startRun('sleep-demo')).rejects.toThrow(/Maximum active runs/i)

    const stopped = await plugin.stopRun(first.id)
    expect(stopped.status).toBe(WorkflowStatus.Aborted)
    const waitTask = stopped.tasks.wait
    expect(waitTask).toBeDefined()
    expect(
      waitTask?.status === TaskStatus.Skipped
      || waitTask?.status === TaskStatus.Failed
      || waitTask?.status === TaskStatus.Completed,
    ).toBe(true)

    // After freeing a slot, another run may start while the second is still live.
    const third = await plugin.startRun('sleep-demo')
    expect(third.status).toBe(WorkflowStatus.Running)
    await plugin.stopRun(second.id)
    await plugin.stopRun(third.id)
  })
})
