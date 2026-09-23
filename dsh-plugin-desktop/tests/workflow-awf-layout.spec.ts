import { describe, expect, it } from 'vitest'
import {
  AWF_RAIL_DEFAULT_WIDTH,
  AWF_RAIL_MAX_WIDTH,
  AWF_RAIL_MIN_WIDTH,
  clampAwfRailWidth,
} from '../src/client/workflow-awf-layout.ts'
import { WORKFLOW_STYLES } from '../src/client/styles-workflow.ts'

describe('clampAwfRailWidth', () => {
  it('clamps to the declared bounds', () => {
    expect(clampAwfRailWidth(AWF_RAIL_MIN_WIDTH - 40, 1200)).toBe(AWF_RAIL_MIN_WIDTH)
    expect(clampAwfRailWidth(AWF_RAIL_MAX_WIDTH + 40, 1200)).toBe(AWF_RAIL_MAX_WIDTH)
    expect(clampAwfRailWidth(360, 1200)).toBe(360)
  })

  it('never eats into the tab content beside it', () => {
    // 900px container - 360px content min => rail max is 540.
    expect(clampAwfRailWidth(AWF_RAIL_MAX_WIDTH, 900, 360)).toBe(540)
    // Tiny container: rail collapses to its own floor.
    expect(clampAwfRailWidth(AWF_RAIL_DEFAULT_WIDTH, 500, 360)).toBe(AWF_RAIL_MIN_WIDTH)
  })

  it('rounds and rejects NaN', () => {
    expect(clampAwfRailWidth(360.6, 1200)).toBe(361)
    expect(clampAwfRailWidth(Number.NaN, 1200)).toBe(AWF_RAIL_DEFAULT_WIDTH)
    expect(clampAwfRailWidth(Number.POSITIVE_INFINITY, 1200)).toBe(AWF_RAIL_MAX_WIDTH)
  })
})

describe('AWF side rail is collapsible and resizable', () => {
  const rule = (selector: string): string => {
    const at = WORKFLOW_STYLES.indexOf(`\n${selector} {`)
    expect(at, `missing CSS rule ${selector}`).toBeGreaterThanOrEqual(0)
    return WORKFLOW_STYLES.slice(at, WORKFLOW_STYLES.indexOf('}', at))
  }

  it('lays the rail out beside the tab content in one row', () => {
    const body = rule('.workflow-body')
    expect(body).toContain('display: flex')
    const rail = rule('.workflow-awf-rail')
    expect(rail).toContain('flex: 0 0 auto')
    expect(rail).toContain('border-left')
    expect(rail).toContain('overflow: hidden')
  })

  it('collapses to a narrow labelled strip', () => {
    const collapsed = rule('.workflow-awf-rail.is-collapsed')
    expect(collapsed).toContain('align-items: center')
    const stub = rule('.workflow-awf-rail-stub')
    expect(stub).toContain('writing-mode: vertical-rl')
  })

  it('scrolls the rail body independently of the tab content', () => {
    const css = rule('.workflow-awf-rail-body')
    expect(css).toContain('overflow: auto')
    expect(css).toContain('min-height: 0')
    expect(rule('.workflow-body .workflow-content')).toContain('min-width: 0')
  })
})
