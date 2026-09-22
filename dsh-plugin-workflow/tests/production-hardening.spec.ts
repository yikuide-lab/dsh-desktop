import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkflowPlugin } from '../src/plugin.ts'
import { WorkflowStore } from '../src/engine/store.ts'
import { isPathInsideRoot, resolveSandboxedCwd } from '../src/engine/path-sandbox.ts'
import { WorkflowStatus, TaskStatus, DispatchStatus } from '../src/engine/models.ts'
import type { Run } from '../src/engine/models.ts'
import { Coordinator } from '../src/engine/coordinator.ts'

const dirs: string[] = []

afterEach(async () => {
  // leave temp dirs; OS cleans /tmp. Keep list for debugging if needed.
  dirs.length = 0
})

async function tempStateDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-workflow-prod-'))
  dirs.push(dir)
  return dir
}

describe('production hardening', () => {
  it('writes runs atomically and serializes updateRun', async () => {
    const stateDir = await tempStateDir()
    const store = new WorkflowStore(stateDir)
    await store.init()
    const run: Run = {
      id: 'run-a',
      workflowName: 'demo',
      status: WorkflowStatus.Running,
      tasks: {},
      gates: {},
      startedAt: new Date().toISOString(),
    }
    await store.saveRun(run)
    const updates = await Promise.all([
      store.updateRun('run-a', (r) => ({ ...r, error: 'one' })),
      store.updateRun('run-a', (r) => ({ ...r, error: `${r.error ?? ''}|two` })),
    ])
    const loaded = await store.loadRun('run-a')
    expect(loaded?.error).toBeTruthy()
    expect(updates.map((u) => u.error).join('')).toContain('two')
  })

  it('appends and loads transcript jsonl', async () => {
    const stateDir = await tempStateDir()
    const store = new WorkflowStore(stateDir)
    await store.init()
    await store.appendTranscript('run-t', { type: 'run.start', data: { ok: true } })
    await store.appendTranscript('run-t', { type: 'llm.request', stepId: 's1', data: { prompt: 'hi' } })
    const events = await store.loadTranscript('run-t')
    expect(events.events).toHaveLength(2)
    expect(events.events[0]?.type).toBe('run.start')
    expect(events.events[1]?.stepId).toBe('s1')
    const raw = await readFile(join(stateDir, 'runs', 'run-t.transcript.jsonl'), 'utf8')
    expect(raw.trim().split('\n')).toHaveLength(2)
  })

  it('jails script cwd under workspaceRoot', () => {
    expect(isPathInsideRoot('/ws', '/ws/a')).toBe(true)
    expect(isPathInsideRoot('/ws', '/etc')).toBe(false)
    expect(() => resolveSandboxedCwd('/etc', '/ws')).toThrow(/escapes workspaceRoot/)
    expect(resolveSandboxedCwd('/ws/sub', '/ws')).toBe(join('/ws/sub'))
  })

  it('fail-closes orphan running runs on init', async () => {
    const stateDir = await tempStateDir()
    await mkdir(join(stateDir, 'runs'), { recursive: true })
    const orphan: Run = {
      id: 'orphan-1',
      workflowName: 'demo',
      status: WorkflowStatus.Running,
      tasks: {
        a: {
          id: 'a',
          stepId: 'a',
          status: TaskStatus.InProgress,
          dispatches: [{
            id: 'd1',
            stepId: 'a',
            status: DispatchStatus.Running,
            attempt: 1,
            startedAt: new Date().toISOString(),
          }],
        },
      },
      gates: {},
      startedAt: new Date().toISOString(),
    }
    await writeFile(join(stateDir, 'runs', 'orphan-1.json'), JSON.stringify(orphan, null, 2))

    const plugin = new WorkflowPlugin({ stateDir, mcpEnabled: false, triggersEnabled: false })
    await plugin.init()
    const loaded = await plugin.getRun('orphan-1')
    expect(loaded?.status).toBe(WorkflowStatus.Aborted)
    expect(loaded?.error).toMatch(/orphan/)
    const transcript = await plugin.getTranscript('orphan-1')
    expect(transcript.events.some((e) => e.type === 'run.orphan')).toBe(true)
  })

  it('preserves orphan runs that only wait on unresolved gates', async () => {
    const stateDir = await tempStateDir()
    await mkdir(join(stateDir, 'runs'), { recursive: true })
    const waiting: Run = {
      id: 'orphan-gate',
      workflowName: 'demo',
      status: WorkflowStatus.Running,
      tasks: {
        approve: {
          id: 'approve',
          stepId: 'approve',
          status: TaskStatus.Pending,
          dispatches: [],
        },
      },
      gates: {
        approve: {
          id: 'gate-approve',
          stepId: 'approve',
          question: 'ok?',
          options: ['approved', 'rejected'],
          token: 'tok-1',
        },
      },
      startedAt: new Date().toISOString(),
    }
    await writeFile(join(stateDir, 'runs', 'orphan-gate.json'), JSON.stringify(waiting, null, 2))

    const plugin = new WorkflowPlugin({ stateDir, mcpEnabled: false, triggersEnabled: false })
    await plugin.init()
    const loaded = await plugin.getRun('orphan-gate')
    expect(loaded?.status).toBe(WorkflowStatus.Running)
    expect(loaded?.gates.approve?.resolved).toBeUndefined()
    const transcript = await plugin.getTranscript('orphan-gate')
    expect(transcript.events.some((e) => e.type === 'run.orphan' && e.data?.preserved)).toBe(true)
  })

  it('offline stopRun uses markAborted for pending tasks', async () => {
    const stateDir = await tempStateDir()
    const plugin = new WorkflowPlugin({ stateDir, mcpEnabled: false, triggersEnabled: false })
    await plugin.init()
    const store = new WorkflowStore(stateDir)
    await store.saveRun({
      id: 'offline-stop',
      workflowName: 'demo',
      status: WorkflowStatus.Running,
      tasks: {
        a: {
          id: 'a',
          stepId: 'a',
          status: TaskStatus.Pending,
          dispatches: [],
        },
      },
      gates: {},
      startedAt: new Date().toISOString(),
    })
    const stopped = await plugin.stopRun('offline-stop')
    expect(stopped.status).toBe(WorkflowStatus.Aborted)
    expect(stopped.tasks.a?.status).toBe(TaskStatus.Skipped)
  })

  it('coalesces overlapping ticks so only one tick runs at a time', async () => {
    const coordinator = new Coordinator({ tickInterval: 5, maxConcurrency: 1 })
    let concurrent = 0
    let maxConcurrent = 0
    let invocations = 0
    coordinator.tick = async () => {
      concurrent += 1
      invocations += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise((r) => setTimeout(r, 35))
      concurrent -= 1
      return { ticks: invocations, dispatches: 0, settlements: 0, errors: 0 }
    }
    // Bypass the "no state" guard by planting a non-null state via resume.
    await coordinator.resume(
      {
        apiVersion: 'workflow-wise/v1',
        kind: 'Workflow',
        metadata: { name: 'tick-test' },
        spec: { steps: [] },
      },
      {
        id: 'tick-run',
        workflowName: 'tick-test',
        status: WorkflowStatus.Completed,
        tasks: {},
        gates: {},
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
      {
        async submit() {},
        async poll() {
          return {
            id: 'x',
            stepId: 'x',
            status: DispatchStatus.Succeeded,
            attempt: 1,
          }
        },
        async abort() {},
      },
    )
    coordinator.start()
    await new Promise((r) => setTimeout(r, 20))
    await new Promise((r) => setTimeout(r, 20))
    await new Promise((r) => setTimeout(r, 100))
    coordinator.stop()
    expect(invocations).toBeGreaterThan(0)
    expect(maxConcurrent).toBe(1)
  })
})
