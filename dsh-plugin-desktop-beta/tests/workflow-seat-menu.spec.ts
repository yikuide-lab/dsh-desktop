/**
 * Interaction smoke for the unified seat menu: open the dropdown and assert the
 * workflow tab lists the injected rows. The field report kept finding no
 * workflows — this drives the real component through the real click so neither
 * the tab switch, the row rendering, nor the once-per-open load can silently
 * regress again (prop-identity churn used to cancel every fetch).
 */

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { WorkflowModelSelect } from '../src/client/WorkflowModelSelect.tsx'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

interface SeatRowData {
  name: string
  title: string
  steps: []
}

const roots: Array<{ root: Root; container: HTMLElement }> = []

afterEach(async () => {
  for (const entry of roots.splice(0)) {
    await act(async () => {
      entry.root.unmount()
    })
    entry.container.remove()
  }
  // Portals append to document.body — drop every leftover menu.
  for (const menu of [...document.body.querySelectorAll('.workflow-seat-menu')]) {
    menu.remove()
  }
})

function seatProps(workflows: SeatRowData[]) {
  // uSES re-renders on every snapshot identity change: the reference must
  // stay stable between mutations (the real directory store does this).
  const snapshot = {
    current: null,
    groups: [{
      id: 'openai',
      name: 'OpenAI',
      models: [{ id: 'gpt-x', name: 'GPT-X' }],
    }],
    status: 'ready',
    error: null,
  }
  return {
    locked: false,
    available: true,
    directory: {
      subscribe: () => () => undefined,
      getSnapshot: () => snapshot,
    },
    load: () => undefined,
    select: async () => true,
    listWorkflows: async () => workflows,
    t: (key: string) => key,
  } as never
}

async function mountSeat(workflows: SeatRowData[], reRender = 0) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push({ root, container })
  await act(async () => {
    root.render(createElement(WorkflowModelSelect, seatProps(workflows)))
  })
  // Churn: re-render with a fresh `listWorkflows` identity every pass — the
  // load must still land exactly once per open instead of restarting forever.
  for (let i = 0; i < reRender; i += 1) {
    await act(async () => {
      root.render(createElement(WorkflowModelSelect, seatProps(workflows)))
    })
  }
  return container
}

async function openSeat(container: HTMLElement) {
  const trigger = container.querySelector<HTMLButtonElement>('.workflow-seat-trigger')
  expect(trigger).not.toBeNull()
  await act(async () => {
    trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  return document.body.querySelector('.workflow-seat-menu') as HTMLElement
}

async function openWorkflowsTab(menu: HTMLElement) {
  const tabs = menu.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  await act(async () => {
    tabs[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('unified seat menu (open → tabs → workflow rows)', () => {
  it('lists injected workflow rows under the workflows tab', async () => {
    const container = await mountSeat([
      { name: 'demo-flow', title: 'Demo Flow', steps: [] },
      { name: 'other', title: 'Other', steps: [] },
    ])
    const menu = await openSeat(container)
    const tabs = menu.querySelectorAll('[role="tab"]')
    expect([...tabs].map(tab => tab.textContent)).toEqual(['seatTabModels', 'seatTabWorkflows2'])

    await openWorkflowsTab(menu)
    const text = menu.textContent ?? ''
    expect(text).toContain('Demo Flow')
    expect(text).toContain('Other')
    expect(text).toContain('seatWorkflowBadge')
    expect(menu.querySelectorAll('.workflow-seat-pin')).toHaveLength(2)
  })

  it('lands the rows even when the injected listWorkflows identity churns', async () => {
    const container = await mountSeat(
      [{ name: 'demo-flow', title: 'Demo Flow', steps: [] }],
      3,
    )
    const menu = await openSeat(container)
    await openWorkflowsTab(menu)
    expect(menu.textContent ?? '').toContain('Demo Flow')
  })

  it('shows the empty state on the workflows tab when nothing is known', async () => {
    const container = await mountSeat([])
    const menu = await openSeat(container)
    await openWorkflowsTab(menu)
    expect(menu.textContent ?? '').toContain('seatWorkflowsEmpty')
  })
})
