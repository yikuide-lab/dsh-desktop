import { describe, expect, it } from 'vitest'
import { buildArmCandidate } from '../src/client/workflow-recommend-candidates.js'

const workflows = [
  { name: 'demo', title: 'Demo', steps: [] },
  { name: 'other', title: 'Other', steps: [] },
]
const templates = [
  { id: 'tpl-clash', name: 'other', description: '', category: 'custom', yaml: 'x: 1' },
  { id: 'tpl-fresh', name: 'fresh', description: '', category: 'custom', yaml: 'y: $PROBLEM' },
]

describe('unified seat arming', () => {
  it('prefers the workspace binding, then a saved workflow, then a template', () => {
    expect(buildArmCandidate({ bindingName: 'demo', workflows, templates, workflowName: 'demo' }))
      .toMatchObject({ id: 'enabled:demo', source: 'enabled' })
    expect(buildArmCandidate({ bindingName: 'demo', workflows, templates, workflowName: 'other' }))
      .toMatchObject({ id: 'saved:other', source: 'saved' })
    const fresh = buildArmCandidate({ bindingName: null, workflows, templates, workflowName: 'fresh' })
    expect(fresh).toMatchObject({ id: 'template:tpl-fresh', source: 'template', needsProblem: true })
    expect(fresh.templateYaml).toBe('y: $PROBLEM')
  })

  it('arms a platform-only name as a minimal saved candidate', () => {
    expect(buildArmCandidate({ bindingName: null, workflows, templates, workflowName: 'remote-only' }))
      .toEqual({
        id: 'saved:remote-only',
        workflowName: 'remote-only',
        title: 'remote-only',
        source: 'saved',
        needsProblem: false,
      })
  })
})
