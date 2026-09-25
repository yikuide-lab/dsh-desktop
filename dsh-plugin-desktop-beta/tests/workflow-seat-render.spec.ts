/**
 * Render smoke for the composer model seat: the seat must actually mount.
 * The unified dropdown sat invisible for two releases because the slot
 * registration died silently — this renders the component for real so a
 * load-time crash can never pass review again.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkflowModelSelect } from '../src/client/WorkflowModelSelect.tsx'

describe('composer model seat render smoke', () => {
  it('renders the trigger (the seat mounts) with the auto caption', () => {
    const html = renderToStaticMarkup(createElement(WorkflowModelSelect, {
      locked: false,
      available: true,
      directory: {
        subscribe: () => () => undefined,
        getSnapshot: () => ({ current: null, groups: [], status: 'ready', error: null }),
      },
      load: () => undefined,
      select: async () => true,
      listWorkflows: async () => [],
      t: (key: string) => key,
    } as never))
    expect(html).toContain('workflow-seat-trigger')
    expect(html).toContain('seatModelAuto')
    expect(html).toContain('▾')
  })

  it('renders a workflow-route caption from the directory selection', () => {
    const html = renderToStaticMarkup(createElement(WorkflowModelSelect, {
      locked: false,
      available: true,
      directory: {
        subscribe: () => () => undefined,
        getSnapshot: () => ({
          current: { provider: 'workflow', model: 'demo-flow' },
          groups: [],
          status: 'ready',
          error: null,
        }),
      },
      load: () => undefined,
      select: async () => true,
      listWorkflows: async () => [],
      t: (key: string) => key,
    } as never))
    expect(html).toContain('demo-flow')
    expect(html).toContain('seatWorkflowBadge')
  })

  it('renders a workflow-icon send control beside the caption when armed', async () => {
    const { setArmedWorkflow } = await import('../src/client/workflow-arm.ts')
    setArmedWorkflow({
      id: 'saved:demo-flow',
      workflowName: 'demo-flow',
      title: 'Demo Flow',
      source: 'saved',
      needsProblem: false,
    })
    try {
      const html = renderToStaticMarkup(createElement(WorkflowModelSelect, {
        locked: false,
        available: true,
        directory: {
          subscribe: () => () => undefined,
          getSnapshot: () => ({ current: null, groups: [], status: 'ready', error: null }),
        },
        load: () => undefined,
        select: async () => true,
        listWorkflows: async () => [],
        api: {} as never,
        openRunsPanel: () => undefined,
        openSettingsPanel: () => undefined,
        t: (key: string) => key,
      } as never))
      expect(html).toContain('workflow-seat-send')
      expect(html).toContain('data-icon="workflow"')
      expect(html).toContain('recommendSend')
      expect(html).toContain('Demo Flow')
    } finally {
      setArmedWorkflow(null)
    }
  })
})
