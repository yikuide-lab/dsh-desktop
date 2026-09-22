import { describe, expect, it, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkflowPlugin } from '../src/plugin.ts'
import { resolveDispatchTimeLimitMs } from '../src/engine/coordinator.ts'
import { StepType, WorkflowStatus } from '../src/engine/models.ts'

describe('dispatch time limit / heartbeat', () => {
  let stateDir: string
  let plugin: WorkflowPlugin

  afterEach(async () => {
    plugin?.stop()
    await plugin?.whenStopped()
    if (stateDir) await rm(stateDir, { recursive: true, force: true })
  })

  it('aligns script steps to 600s when timeout omitted', () => {
    expect(resolveDispatchTimeLimitMs(
      { id: 's', type: StepType.Script, run: 'true' },
      30_000,
    )).toBe(600_000)
  })

  it('uses explicit step.timeout over heartbeat ceiling', () => {
    expect(resolveDispatchTimeLimitMs(
      { id: 's', type: StepType.Script, run: 'true', timeout: 45 },
      30_000,
    )).toBe(45_000)
  })

  it('uses heartbeat ceiling for non-script steps without timeout', () => {
    expect(resolveDispatchTimeLimitMs(
      { id: 'l', type: StepType.LLM, prompt: 'hi' },
      900_000,
    )).toBe(900_000)
  })

  it('does not kill a sleep 2 script when heartbeat is shorter than step timeout', async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'dsh-wf-hb-'))
    plugin = new WorkflowPlugin({
      stateDir,
      mcpEnabled: false,
      triggersEnabled: false,
      tickInterval: 40,
      heartbeatTimeout: 500,
      scriptPolicy: 'allow',
    })
    await plugin.init()

    await plugin.createWorkflow(`
apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: sleep-ok
spec:
  steps:
    - id: nap
      type: script
      run: sleep 2
      timeout: 60
`)

    const started = await plugin.startRun('sleep-ok')
    const deadline = Date.now() + 8_000
    let finished = await plugin.getRun(started.id)
    while (finished && finished.status === WorkflowStatus.Running && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50))
      finished = await plugin.getRun(started.id)
    }
    expect(finished?.status).toBe(WorkflowStatus.Completed)
    expect(finished?.error ?? '').not.toMatch(/dispatch timeout|heartbeat/i)
  })
})
