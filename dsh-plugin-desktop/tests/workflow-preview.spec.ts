import { describe, expect, it } from 'vitest'
import { parseWorkflowYaml } from '../src/client/workflow-template-clone.ts'
import { stepsToGraph } from '../src/client/workflow-canvas-layout.ts'

const sampleYaml = `
apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: preview-demo
  title: Preview Demo
spec:
  steps:
    - id: route
      type: llm
      role: router
      prompt: choose
    - id: implement
      type: llm
      role: implement
      deps: [route]
      prompt: code
    - id: nested
      type: sub_workflow
      ref: other-flow
      deps: [implement]
`

describe('workflow preview parse', () => {
  it('parses template yaml into canvas steps', () => {
    const view = parseWorkflowYaml(sampleYaml)
    expect(view.name).toBe('preview-demo')
    expect(view.steps.map((step) => step.id)).toEqual(['route', 'implement', 'nested'])
    expect(view.steps[1]?.deps).toEqual(['route'])
  })

  it('annotates sub_workflow nodes with ref', () => {
    const view = parseWorkflowYaml(sampleYaml)
    const { nodes } = stepsToGraph(view.steps)
    const nested = nodes.find((node) => node.id === 'nested')
    expect(nested?.data.detail).toBe('other-flow')
    expect(nested?.data.unsupported).toBeUndefined()
  })
})
