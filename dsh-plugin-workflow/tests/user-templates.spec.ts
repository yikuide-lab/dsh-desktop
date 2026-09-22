import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkflowPlugin } from '../src/plugin.ts'

const sampleYaml = `
apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: promote-demo
  title: Promote Demo
  description: For template promotion tests
spec:
  steps:
    - id: hello
      type: script
      run: echo hi
`

describe('user workflow templates', () => {
  let stateDir: string
  let plugin: WorkflowPlugin

  afterEach(async () => {
    plugin?.stop()
    if (stateDir) await rm(stateDir, { recursive: true, force: true })
  })

  it('promotes a saved workflow and lists it beside builtins', async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'dsh-wf-tpl-'))
    plugin = new WorkflowPlugin({ stateDir, mcpEnabled: false })
    await plugin.init()

    const created = await plugin.createWorkflow(sampleYaml)
    expect(created.validation.ok).toBe(true)

    const promoted = await plugin.promoteWorkflowToTemplate('promote-demo')
    expect(promoted.builtin).toBe(false)
    expect(promoted.sourceWorkflowName).toBe('promote-demo')
    expect(promoted.yaml).toContain('name: promote-demo')

    const listed = plugin.listTemplates()
    expect(listed.some((entry) => entry.builtin === true)).toBe(true)
    expect(listed.some((entry) => entry.id === promoted.id && entry.builtin === false)).toBe(true)

    // Original workflow remains.
    expect(await plugin.getWorkflow('promote-demo')).not.toBeNull()
  })

  it('rejects deleting builtins and allows deleting user templates', async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'dsh-wf-tpl-del-'))
    plugin = new WorkflowPlugin({ stateDir, mcpEnabled: false })
    await plugin.init()

    await plugin.createWorkflow(sampleYaml)
    const promoted = await plugin.promoteWorkflowToTemplate('promote-demo', { id: 'user-promote-demo' })
    await expect(plugin.deleteUserTemplate('code-review')).rejects.toThrow(/built-in/i)
    expect(await plugin.deleteUserTemplate(promoted.id)).toBe(true)
    expect(plugin.listTemplates().some((entry) => entry.id === promoted.id)).toBe(false)
  })
})
