import { describe, expect, it } from 'vitest'
import { mapEngineRun, mapEngineWorkflow, workflowViewToYaml } from '../src/client/desktop-workflow-api.ts'
import { executeDesktopWorkflowOp } from '../src/desktop-workflow-controller.ts'
import { WorkflowPlugin } from 'dsh-plugin-workflow'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'

describe('desktop workflow api mapping', () => {
  it('flattens engine workflows and round-trips yaml', () => {
    const view = mapEngineWorkflow({
      apiVersion: 'workflow-wise/v1',
      kind: 'Workflow',
      metadata: { name: 'demo', title: 'Demo', description: 'd' },
      spec: {
        steps: [
          { id: 'a', type: 'script', run: 'echo a' },
          { id: 'b', type: 'approval', deps: ['a'], question: 'ok?', options: ['approved', 'rejected'] },
        ],
      },
    })
    expect(view.name).toBe('demo')
    expect(view.steps).toHaveLength(2)
    const yaml = workflowViewToYaml(view)
    expect(yaml).toContain('apiVersion: workflow-wise/v1')
    expect(yaml).toContain('name: demo')
  })

  it('flattens run tasks into step statuses', () => {
    const run = mapEngineRun({
      id: 'run-1',
      workflowName: 'demo',
      status: 'running',
      startedAt: '2026-01-01T00:00:00Z',
      tasks: {
        a: { id: 't-a', stepId: 'a', status: 'completed', dispatches: [] },
        b: { id: 't-b', stepId: 'b', status: 'in_progress', dispatches: [] },
      },
      gates: {
        b: {
          id: 'g-b',
          stepId: 'b',
          question: 'ok?',
          options: ['approved', 'needs-changes'],
          pass: ['approved'],
          token: 'tok',
        },
      },
    })
    expect(run.steps?.map(s => s.status)).toEqual(['completed', 'running'])
    expect(run.gates).toHaveLength(1)
    expect(run.gates?.[0]?.pass).toEqual(['approved'])
  })
})

describe('desktop workflow controller', () => {
  let stateDir: string
  let plugin: WorkflowPlugin

  afterEach(async () => {
    plugin?.stop()
    if (stateDir) await rm(stateDir, { recursive: true, force: true })
  })

  it('saves templates and resolves ops', async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'dsh-desktop-wf-'))
    plugin = new WorkflowPlugin({ stateDir, mcpEnabled: false })
    await plugin.init()

    const templates = await executeDesktopWorkflowOp(plugin, { op: 'listTemplates' })
    expect(Array.isArray(templates)).toBe(true)

    const yaml = `
apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: ctrl-demo
spec:
  steps:
    - id: echo
      type: script
      run: echo hi
`
    const saved = await executeDesktopWorkflowOp(plugin, { op: 'saveWorkflow', yaml }) as {
      validation: { ok: boolean }
    }
    expect(saved.validation.ok).toBe(true)

    const listed = await executeDesktopWorkflowOp(plugin, { op: 'listWorkflows' })
    expect(Array.isArray(listed)).toBe(true)

    const canonical = await executeDesktopWorkflowOp(plugin, {
      op: 'canonicalizeYaml',
      yaml,
    }) as { yaml: string }
    expect(canonical.yaml).toContain('apiVersion: workflow-wise/v1')
    expect(canonical.yaml).toContain('name: ctrl-demo')

    const exported = await executeDesktopWorkflowOp(plugin, {
      op: 'exportWorkflowYaml',
      name: 'ctrl-demo',
    }) as { yaml: string }
    expect(exported.yaml).toContain('name: ctrl-demo')
  })

  it('aggregates per-workflow usage stats from retained runs', async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'dsh-desktop-wf-stats-'))
    plugin = new WorkflowPlugin({ stateDir, mcpEnabled: false })
    await plugin.init()

    const yaml = `
apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: stats-demo
  title: Stats Demo
spec:
  steps:
    - id: echo
      type: script
      run: echo hi
`
    await executeDesktopWorkflowOp(plugin, { op: 'saveWorkflow', yaml })

    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(join(stateDir, 'runs'), { recursive: true })
    await writeFile(join(stateDir, 'runs', 'run-ok.json'), JSON.stringify({
      id: 'run-ok',
      workflowName: 'stats-demo',
      status: 'completed',
      startedAt: '2026-09-01T02:00:00.000Z',
      completedAt: '2026-09-01T02:00:10.000Z',
      tasks: {},
      gates: {},
      schemaVersion: 1,
    }), 'utf8')
    await writeFile(join(stateDir, 'runs', 'run-fail.json'), JSON.stringify({
      id: 'run-fail',
      workflowName: 'stats-demo',
      status: 'failed',
      startedAt: '2026-09-02T02:00:00.000Z',
      completedAt: '2026-09-02T02:00:20.000Z',
      error: 'boom',
      tasks: {},
      gates: {},
      schemaVersion: 1,
    }), 'utf8')
    await writeFile(join(stateDir, 'runs', 'run-child.json'), JSON.stringify({
      id: 'run-child',
      workflowName: 'stats-demo',
      status: 'completed',
      startedAt: '2026-09-02T03:00:00.000Z',
      completedAt: '2026-09-02T03:00:05.000Z',
      parentRunId: 'run-ok',
      tasks: {},
      gates: {},
      schemaVersion: 1,
    }), 'utf8')

    const summaries = await executeDesktopWorkflowOp(plugin, {
      op: 'getWorkflowStats',
      workflowName: 'stats-demo',
    }) as Array<Record<string, unknown>>
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({
      workflowName: 'stats-demo',
      title: 'Stats Demo',
      totalRuns: 2,
      completed: 1,
      failed: 1,
    })

    const detail = await executeDesktopWorkflowOp(plugin, {
      op: 'getWorkflowStatsDetail',
      workflowName: 'stats-demo',
      since: '2026-08-01T00:00:00.000Z',
      recentLimit: 5,
    }) as Record<string, unknown>
    expect(detail.totalRuns).toBe(2)
    expect(Array.isArray(detail.byDay)).toBe(true)
    expect(Array.isArray(detail.recentRuns)).toBe(true)
    expect((detail.recentRuns as unknown[]).length).toBe(2)
  })
})
