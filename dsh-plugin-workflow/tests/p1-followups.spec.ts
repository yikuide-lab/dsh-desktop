import { describe, expect, it, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkflowPlugin } from '../src/plugin.ts'
import { evaluateTriggerFilter } from '../src/triggers/trigger.ts'
import { resolveEffectiveConcurrency, buildApprovalGate, createGate } from '../src/engine/engine.ts'
import { resolveScriptCwd } from '../src/engine/script-policy.ts'
import { StepType, WorkflowStatus, RUN_SCHEMA_VERSION } from '../src/engine/models.ts'
import type { Workflow } from '../src/engine/models.ts'

describe('p1 follow-ups', () => {
  let stateDir: string
  let plugin: WorkflowPlugin

  afterEach(async () => {
    plugin?.stop()
    await plugin?.whenStopped()
    if (stateDir) await rm(stateDir, { recursive: true, force: true })
  })

  it('evaluates trigger filters with AND clauses', () => {
    const event = {
      source: 'git',
      name: 'push',
      data: { status: 'ok', nested: { n: 1 } },
      timestamp: new Date().toISOString(),
    }
    expect(evaluateTriggerFilter(undefined, event)).toBe(true)
    expect(evaluateTriggerFilter('source=git,name=push', event)).toBe(true)
    expect(evaluateTriggerFilter('data.status=ok', event)).toBe(true)
    expect(evaluateTriggerFilter('data.nested.n=1', event)).toBe(true)
    expect(evaluateTriggerFilter('source=ci', event)).toBe(false)
  })

  it('resolves effective concurrency from spec resources', () => {
    const workflow: Workflow = {
      apiVersion: 'workflow-wise/v1',
      kind: 'Workflow',
      metadata: { name: 'c' },
      spec: {
        max_concurrency: 3,
        resources: [{ name: 'concurrency', limit: 2 }],
        steps: [{ id: 'a', type: StepType.Script, run: 'true' }],
      },
    }
    expect(resolveEffectiveConcurrency(workflow, 8)).toBe(2)
  })

  it('enforces scriptPolicy deny and workspace-only', () => {
    expect(() => resolveScriptCwd('deny', '/ws', '/ws')).toThrow(/disabled/)
    expect(() => resolveScriptCwd('workspace-only', '/ws', undefined)).toThrow(/WORKSPACE_ROOT/)
    expect(resolveScriptCwd('workspace-only', '/ws/a', '/ws')).toContain(`${join('/ws')}`)
  })

  it('buildApprovalGate / createGate use workflow step lookup', () => {
    const step = {
      id: 'approve',
      type: StepType.Approval as const,
      question: 'Go?',
      options: ['yes', 'no'],
      pass: ['yes'],
    }
    const gate = buildApprovalGate(step)
    expect(gate.pass).toEqual(['yes'])
    const workflow: Workflow = {
      apiVersion: 'workflow-wise/v1',
      kind: 'Workflow',
      metadata: { name: 'g' },
      spec: { steps: [step] },
    }
    const created = createGate({
      id: 'r',
      workflowName: 'g',
      status: WorkflowStatus.Running,
      tasks: {},
      gates: {},
      startedAt: new Date().toISOString(),
      schemaVersion: RUN_SCHEMA_VERSION,
    }, workflow, 'approve')
    expect(created.gate.stepId).toBe('approve')
    expect(created.run.gates.approve?.token).toBeTruthy()
  })

  it('persists triggers and purges old runs', async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'dsh-wf-p1-'))
    plugin = new WorkflowPlugin({
      stateDir,
      mcpEnabled: false,
      triggersEnabled: true,
      maxRetainedRuns: 1,
      maxRunAgeDays: 0,
    })
    await plugin.init()

    await plugin.createWorkflow(`
apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: trig-demo
spec:
  steps:
    - id: echo
      type: script
      run: echo hi
`)
    const added = plugin.addTrigger({
      type: 'event',
      workflowName: 'trig-demo',
      source: 'test',
      on: 'ping',
      filter: 'data.ok=true',
    })
    expect(plugin.listTriggers()).toHaveLength(1)

    plugin.stop()
    await plugin.whenStopped()

    plugin = new WorkflowPlugin({
      stateDir,
      mcpEnabled: false,
      triggersEnabled: true,
      maxRetainedRuns: 1,
    })
    await plugin.init()
    expect(plugin.listTriggers().some((t) => t.id === added.id)).toBe(true)

    await mkdir(join(stateDir, 'runs'), { recursive: true })
    const old = {
      id: 'old-run',
      workflowName: 'trig-demo',
      status: WorkflowStatus.Completed,
      tasks: {},
      gates: {},
      startedAt: '2020-01-01T00:00:00.000Z',
      completedAt: '2020-01-01T00:01:00.000Z',
      schemaVersion: 1,
    }
    const newer = {
      ...old,
      id: 'new-run',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    }
    await writeFile(join(stateDir, 'runs', 'old-run.json'), JSON.stringify(old, null, 2))
    await writeFile(join(stateDir, 'runs', 'new-run.json'), JSON.stringify(newer, null, 2))
    const purged = await plugin.purgeRuns()
    expect(purged.deleted).toBeGreaterThanOrEqual(1)
    expect(await plugin.getRun('old-run')).toBeNull()
  })
})
