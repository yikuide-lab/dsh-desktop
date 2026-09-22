import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkflowPlugin } from '../src/plugin.js'
import { parseWorkflow, WORKFLOW_API_VERSION } from '../src/engine/models.js'

describe('workflow plugin UI foundation', () => {
  let stateDir: string
  let plugin: WorkflowPlugin

  afterEach(async () => {
    plugin?.stop()
    await plugin?.whenStopped()
    if (stateDir) await rm(stateDir, { recursive: true, force: true })
  })

  async function boot(): Promise<WorkflowPlugin> {
    stateDir = await mkdtemp(join(tmpdir(), 'dsh-workflow-'))
    plugin = new WorkflowPlugin({ stateDir, mcpEnabled: false, tickInterval: 50 })
    await plugin.init()
    return plugin
  }

  it('accepts legacy apiVersion alias and saves workflows', async () => {
    const p = await boot()
    const yaml = `
apiVersion: wfwise.io/v1
kind: Workflow
metadata:
  name: review-demo
  title: Review
spec:
  steps:
    - id: lint
      type: script
      run: echo lint
    - id: approve
      type: approval
      deps: [lint]
      question: ok?
      options: [approved, rejected]
`
    const parsed = await parseWorkflow(yaml)
    expect(parsed.apiVersion).toBe(WORKFLOW_API_VERSION)

    const saved = await p.createWorkflow(yaml)
    expect(saved.validation.ok).toBe(true)
    expect(saved.workflow.metadata.name).toBe('review-demo')

    const listed = await p.listWorkflows()
    expect(listed.map(w => w.metadata.name)).toContain('review-demo')
  })

  it('binds a workflow to a workspace and starts a bound run', async () => {
    const p = await boot()
    await p.createWorkflow(`
apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: analysis
  title: Analysis
spec:
  steps:
    - id: note
      type: script
      run: echo analysis
`)
    const binding = await p.setBinding('/tmp/project', 'analysis')
    expect(binding.workflowName).toBe('analysis')

    const run = await p.startBoundRun('/tmp/project', { workspaceRoot: '/tmp/project' })
    expect(run.workflowName).toBe('analysis')
    expect(run.params?.workspaceId).toBe('/tmp/project')
  })

  it('lists builtin templates with canonical apiVersion', async () => {
    const p = await boot()
    const templates = p.listTemplates()
    expect(templates.length).toBeGreaterThan(0)
    expect(templates.every(t => t.yaml.includes(WORKFLOW_API_VERSION))).toBe(true)
    const multi = templates.find(t => t.id === 'multi-llm-code-review')
    expect(multi).toBeTruthy()
    expect(multi?.category).toBe('development')
    expect(multi?.yaml).toContain('review-security')
    expect(multi?.yaml).toContain('review-quality')
    expect(multi?.yaml).toContain('review-architecture')
    expect(multi?.yaml).toContain('summarize')
    const validation = await p.validateYaml(multi!.yaml)
    expect(validation.ok).toBe(true)

    const problem = templates.find(t => t.id === 'multi-llm-problem-review')
    expect(problem).toBeTruthy()
    expect(problem?.category).toBe('analysis')
    expect(problem?.yaml).toContain('$PROBLEM')
    expect(problem?.yaml).toContain('collect-context')
    expect(problem?.yaml).toContain('summarize')
    const problemValidation = await p.validateYaml(problem!.yaml)
    expect(problemValidation.ok).toBe(true)

    const coder = templates.find(t => t.id === 'multi-llm-coder')
    expect(coder).toBeTruthy()
    expect(coder?.yaml).toContain('$PROMPT')
    expect(coder?.yaml).toContain('route')
    expect(coder?.yaml).toContain('implement')
    expect(coder?.yaml).toContain('synthesize')
    const coderValidation = await p.validateYaml(coder!.yaml)
    expect(coderValidation.ok).toBe(true)

    const stock = templates.find(t => t.id === 'stock-trading-signal-review-approval-gate')
    expect(stock).toBeTruthy()
    expect(stock?.yaml).toContain('$PROMPT')
    expect(stock?.yaml).toContain('review-technical')
    expect(stock?.yaml).toContain('discuss')
    expect(stock?.yaml).toContain('decide')
    expect(stock?.yaml).not.toMatch(/^\s+type:\s*approval\s*$/m)
    const stockValidation = await p.validateYaml(stock!.yaml)
    expect(stockValidation.ok).toBe(true)
  })
})