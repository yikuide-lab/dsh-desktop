import { describe, expect, it } from 'vitest'
import {
  allocateCloneName,
  cloneTemplateYaml,
  parseWorkflowYaml,
} from '../src/client/workflow-template-clone.ts'

const sampleYaml = `apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: multi-llm-coder
  title: Multi-LLM Coder
  description: demo
spec:
  max_concurrency: 3
  steps:
    - id: route
      type: llm
      role: router
      prompt: |
        pick a path
`

describe('workflow template clone', () => {
  it('allocates unique copy names', () => {
    expect(allocateCloneName('demo')).toBe('demo-copy')
    expect(allocateCloneName('demo', ['demo-copy'])).toBe('demo-copy-2')
    expect(allocateCloneName('demo', ['demo-copy', 'demo-copy-2'])).toBe('demo-copy-3')
  })

  it('clones template yaml under a new name without mutating the source label', () => {
    const cloned = cloneTemplateYaml(sampleYaml, ['multi-llm-coder'])
    expect(cloned.name).toBe('multi-llm-coder-copy')
    expect(cloned.view.name).toBe('multi-llm-coder-copy')
    expect(cloned.view.title).toBe('Multi-LLM Coder (copy)')
    expect(cloned.yaml).toContain('name: multi-llm-coder-copy')
    expect(cloned.yaml).toContain('max_concurrency: 3')
    expect(sampleYaml).toContain('name: multi-llm-coder')
  })

  it('strips source uid so a copy gets a fresh identity on save', () => {
    const withUid = `apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  uid: 11111111-1111-4111-8111-111111111111
  name: demo
  title: Demo
spec:
  steps:
    - id: echo
      type: script
      run: echo hi
`
    const cloned = cloneTemplateYaml(withUid, ['demo'])
    expect(cloned.yaml).not.toContain('11111111-1111-4111-8111-111111111111')
    expect(cloned.view.uid).toBeUndefined()
    expect(cloned.name).toBe('demo-copy')
  })

  it('parses yaml into the visual editor model', () => {
    const view = parseWorkflowYaml(sampleYaml)
    expect(view.steps).toHaveLength(1)
    expect(view.steps[0]?.id).toBe('route')
    expect(view.steps[0]?.type).toBe('llm')
  })
})
