import { describe, expect, it, vi } from 'vitest'
import { mapEngineRun, mapEngineWorkflow, workflowViewToYaml } from '../src/client/desktop-workflow-api.ts'
import { parseWorkflowYaml } from '../src/client/workflow-template-clone.ts'
import { resolveWorkflowForDeps } from '../src/client/workflow-deps-ensure.ts'
import { buildRunParams, looksLikeAbsolutePath, pickCurrentSessionCwd, pickSessionCwd } from '../src/client/workflow-run-params.ts'
import type { DesktopWorkflowApi, WorkflowView } from '../src/client/desktop-workflow-api.ts'

describe('workflowViewToYaml round-trip', () => {
  it('preserves task inputs/outputs/acceptance/env across visual yaml', () => {
    const view: WorkflowView = {
      name: 'task-demo',
      title: 'Task Demo',
      steps: [{
        id: 'implement',
        type: 'task',
        role: 'coder',
        env: { FOO: 'bar' },
        inputs: { file: 'src/a.ts' },
        outputs: ['src/a.ts'],
        acceptance: ['tests pass'],
        deps: ['plan'],
      }, {
        id: 'plan',
        type: 'llm',
        prompt: 'plan it',
      }],
    }

    const yaml = workflowViewToYaml(view)
    expect(yaml).toContain('inputs:')
    expect(yaml).toContain('file: src/a.ts')
    expect(yaml).toContain('outputs: [src/a.ts]')
    expect(yaml).toContain('acceptance:')
    expect(yaml).toContain('FOO: bar')

    const parsed = parseWorkflowYaml(yaml)
    const implement = parsed.steps.find((step) => step.id === 'implement')
    expect(implement?.env).toEqual({ FOO: 'bar' })
    expect(implement?.inputs).toEqual({ file: 'src/a.ts' })
    expect(implement?.outputs).toEqual(['src/a.ts'])
    expect(implement?.acceptance).toEqual(['tests pass'])
  })

  it('maps skipped tasks distinctly from completed', () => {
    const run = mapEngineRun({
      id: 'run-1',
      workflowName: 'demo',
      status: 'completed',
      tasks: {
        a: { stepId: 'a', status: 'skipped', dispatches: [] },
        b: { stepId: 'b', status: 'completed', dispatches: [] },
      },
      gates: {},
    })
    expect(run.steps?.map((step) => step.status)).toEqual(['skipped', 'completed'])
  })
})

describe('resolveWorkflowForDeps template materialize', () => {
  it('reuses an existing saved workflow instead of overwriting', async () => {
    const existing: WorkflowView = {
      name: 'multi-llm-coder',
      title: 'Customized',
      steps: [{ id: 'x', type: 'llm', prompt: 'custom' }],
    }
    const api = {
      getWorkflow: vi.fn(async () => existing),
      saveWorkflow: vi.fn(async () => {
        throw new Error('should not save')
      }),
    } as unknown as DesktopWorkflowApi

    const resolved = await resolveWorkflowForDeps(api, {
      workflowName: 'multi-llm-coder',
      source: 'template',
      templateYaml: 'apiVersion: workflow-wise/v1\nkind: Workflow\nmetadata:\n  name: multi-llm-coder\n',
    })
    expect(resolved.title).toBe('Customized')
    expect(api.saveWorkflow).not.toHaveBeenCalled()
  })

  it('materializes the template when no saved workflow exists', async () => {
    const created: WorkflowView = {
      name: 'multi-llm-coder',
      title: 'Builtin',
      steps: [{ id: 'x', type: 'llm' }],
    }
    const api = {
      getWorkflow: vi.fn(async () => null),
      saveWorkflow: vi.fn(async () => ({
        workflow: created,
        validation: { ok: true, errors: [] },
      })),
    } as unknown as DesktopWorkflowApi

    const resolved = await resolveWorkflowForDeps(api, {
      workflowName: 'multi-llm-coder',
      source: 'template',
      templateYaml: 'yaml',
    })
    expect(resolved.title).toBe('Builtin')
    expect(api.saveWorkflow).toHaveBeenCalledOnce()
  })
})

describe('mapEngineWorkflow reads env/harness', () => {
  it('maps env onto the flat view', () => {
    const view = mapEngineWorkflow({
      apiVersion: 'workflow-wise/v1',
      kind: 'Workflow',
      metadata: { name: 'env-demo' },
      spec: {
        steps: [{ id: 's', type: 'script', run: 'echo', env: { A: '1' }, harness: 'default' }],
      },
    })
    expect(view.steps[0]?.env).toEqual({ A: '1' })
    expect(view.steps[0]?.harness).toBe('default')
  })
})

describe('buildRunParams workspaceRoot', () => {
  it('accepts absolute paths and rejects relative/URL-like ids', () => {
    expect(looksLikeAbsolutePath('/home/me/proj')).toBe(true)
    expect(looksLikeAbsolutePath('C:\\Users\\me')).toBe(true)
    expect(looksLikeAbsolutePath('default')).toBe(false)
    expect(looksLikeAbsolutePath('/workspace/abc')).toBe(true)

    const withRoot = buildRunParams('ws-1', 'fix it', '/home/me/proj')
    expect(withRoot.workspaceRoot).toBe('/home/me/proj')
    expect(withRoot.PROBLEM).toBe('fix it')

    const withoutRoot = buildRunParams('ws-1', undefined, 'not-a-path')
    expect(withoutRoot.workspaceRoot).toBeUndefined()
    expect(withoutRoot.workspaceId).toBe('ws-1')
  })

  it('picks absolute session cwd from sessions list state', () => {
    expect(pickCurrentSessionCwd({
      current: 's1',
      byId: { s1: { cwd: '/work/a' }, s2: { cwd: '/work/b' } },
    })).toBe('/work/a')
    expect(pickSessionCwd({
      current: 's1',
      byId: { s1: { cwd: '/work/a' }, s2: { cwd: '/work/b' } },
    }, 's2')).toBe('/work/b')
    expect(pickCurrentSessionCwd({
      current: 's1',
      byId: { s1: { cwd: 'relative' } },
    })).toBeUndefined()
  })
})
