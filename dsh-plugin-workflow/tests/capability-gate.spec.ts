import { describe, expect, it } from 'vitest'
import {
  engineCapabilities,
  parseWorkflow,
  validateWorkflow,
} from '../src/engine/models.ts'
import { getToolByName } from '../src/mcp/tools.ts'

function yamlWith(requires: string | null, extraMeta = ''): string {
  const req = requires ? `  requires: [${requires}]\n` : ''
  return `apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: cap-demo
${extraMeta}${req}spec:
  steps:
    - id: say
      type: script
      run: echo hi
`
}

describe('capability negotiation (AWF twin DSL)', () => {
  it('engineCapabilities lists base step types and features', () => {
    const caps = engineCapabilities()
    expect(caps.dslVersion).toBe('workflow-wise/v1')
    expect(caps.stepTypes).toEqual(expect.arrayContaining(['script', 'task', 'llm', 'approval', 'sub_workflow']))
    expect(caps.features).toContain('gate')
  })

  it('metadata.requires round-trips through parse', async () => {
    const wf = await parseWorkflow(yamlWith('script, gate'))
    expect(wf.metadata.requires).toEqual(['script', 'gate'])
  })

  it('satisfied requires validates; missing capability fails with capability_missing', async () => {
    const ok = validateWorkflow(await parseWorkflow(yamlWith('script, sub_workflow')))
    expect(ok.ok).toBe(true)

    const bad = validateWorkflow(await parseWorkflow(yamlWith('bloom')))
    expect(bad.ok).toBe(false)
    const missing = bad.errors.find((e) => e.code === 'capability_missing')
    expect(missing?.path).toBe('metadata.requires')
    expect(missing?.message).toContain('bloom')
  })

  it('unknown step types still fail loudly at parse (no silent skip)', async () => {
    await expect(
      parseWorkflow(
        yamlWith(null).replace(
          '    - id: say\n      type: script\n      run: echo hi\n',
          '    - id: magic\n      type: bloom\n',
        ),
      ),
    ).rejects.toThrow(/invalid type/)
  })

  it('MCP exposes workflow_capabilities tool', async () => {
    const tool = getToolByName('workflow_capabilities')
    expect(tool).toBeTruthy()
    const out = await tool!.handler({}, {} as never)
    expect(out).toMatchObject({ dslVersion: 'workflow-wise/v1' })
  })
})

describe('resource declarations', () => {
  function yamlWithResources(resourcesYaml: string): string {
    return `apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: res-demo
spec:
  resources:
${resourcesYaml}
  steps:
    - id: say
      type: script
      run: echo hi
`
  }

  it('accepts concurrency resources without warnings', async () => {
    const result = validateWorkflow(await parseWorkflow(yamlWithResources(
      '    - name: concurrency\n      limit: 2',
    )))
    expect(result.ok).toBe(true)
    expect(result.errors.filter((e) => e.code === 'resource_unenforced')).toHaveLength(0)
  })

  it('warns on non-concurrency resources (declared but not enforced)', async () => {
    const result = validateWorkflow(await parseWorkflow(yamlWithResources(
      '    - name: compute\n      type: compute\n      limit: 4',
    )))
    expect(result.ok).toBe(true) // warning only
    const warning = result.errors.find((e) => e.code === 'resource_unenforced')
    expect(warning?.severity).toBe('warning')
    expect(warning?.message).toContain('compute')
    expect(warning?.message).toContain('only "concurrency" is implemented')
  })

  it('rejects a non-positive concurrency limit', async () => {
    const result = validateWorkflow(await parseWorkflow(yamlWithResources(
      '    - name: concurrency\n      limit: 0',
    )))
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.message.includes('limit must be a positive number'))).toBe(true)
  })
})

describe('MCP argument narrowing', () => {
  it('workflow_validate rejects a non-string yaml arg', async () => {
    const tool = getToolByName('workflow_validate')!
    await expect(tool.handler({ yaml: 42 }, {} as never))
      .rejects.toThrow(/Argument "yaml" must be a non-empty string/)
  })

  it('workflow_get rejects a missing name arg', async () => {
    const tool = getToolByName('workflow_get')!
    await expect(tool.handler({}, {} as never))
      .rejects.toThrow(/Argument "name" must be a non-empty string/)
  })

  it('run_create rejects a non-object params arg', async () => {
    const tool = getToolByName('run_create')!
    await expect(tool.handler({ workflow: 'w', params: 'not-an-object' }, {} as never))
      .rejects.toThrow(/Argument "params" must be an object/)
  })
})
