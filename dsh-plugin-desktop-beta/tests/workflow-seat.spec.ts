import { describe, expect, it } from 'vitest'
import { WORKFLOW_PROVIDER_ID } from '../src/client/WorkflowModelSelect.tsx'
import { WORKFLOW_STYLES } from '../src/client/styles-workflow.ts'

describe('composer model seat (tabbed models / workflows)', () => {
  const rule = (selector: string): string => {
    const at = WORKFLOW_STYLES.indexOf(`\n${selector} {`)
    expect(at, `missing CSS rule ${selector}`).toBeGreaterThanOrEqual(0)
    return WORKFLOW_STYLES.slice(at, WORKFLOW_STYLES.indexOf('}', at))
  }

  it('identifies workflow-backed routes with one stable provider id', () => {
    // The workflow engine's OpenAI surface keys `model` to the workflow name, so
    // the seat must keep this provider id stable for routing to line up.
    expect(WORKFLOW_PROVIDER_ID).toBe('workflow')
  })

  it('pins the menu to the viewport so it escapes the composer clip', () => {
    const menu = rule('.workflow-seat-menu')
    expect(menu).toContain('position: fixed')
    expect(menu).toContain('z-index')
  })

  it('renders the two categories as a tablist', () => {
    const tabs = rule('.workflow-seat-tabs')
    expect(tabs).toContain('display: flex')
    expect(rule('.workflow-seat-tab.active')).toContain('border-bottom-color')
  })

  it('badges workflow rows so a special model type never reads as a bare model', () => {
    const badge = rule('.workflow-seat-badge')
    expect(badge).toContain('font-size: 10px')
    expect(rule('.workflow-seat-list')).toContain('overflow: auto')
  })

  it('truncates the trigger caption instead of widening the composer', () => {
    const caption = rule('.workflow-seat-caption')
    expect(caption).toContain('text-overflow: ellipsis')
    expect(caption).toContain('white-space: nowrap')
  })
})
