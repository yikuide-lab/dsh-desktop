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
