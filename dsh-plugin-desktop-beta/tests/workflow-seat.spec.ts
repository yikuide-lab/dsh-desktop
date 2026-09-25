import { describe, expect, it } from 'vitest'
import { WORKFLOW_PROVIDER_ID } from '../src/client/WorkflowModelSelect.tsx'
import { readSeatPins, toggleSeatPin, SEAT_PINS_STORAGE_KEY } from '../src/client/seat-pins.ts'
import { WORKFLOW_STYLES } from '../src/client/styles-workflow.ts'

describe('composer model seat (unified models + workflows)', () => {
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

  it('lays out a per-row pin toggle and a pinned state', () => {
    const row = rule('.workflow-seat-row')
    expect(row).toContain('display: flex')
    const pin = rule('.workflow-seat-pin')
    expect(pin).toContain('cursor: pointer')
    expect(rule('.workflow-seat-pin.active')).toContain('opacity: 1')
  })

  it('offers a manual refresh beside the menu title', () => {
    const refresh = rule('.workflow-seat-refresh')
    expect(refresh).toContain('cursor: pointer')
    expect(rule('.workflow-seat-refresh:disabled')).toContain('opacity')
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

describe('seat pin list', () => {
  it('parses stored pins defensively', () => {
    expect(readSeatPins(null)).toEqual([])
    expect(readSeatPins('not json')).toEqual([])
    expect(readSeatPins('{"a":1}')).toEqual([])
    expect(readSeatPins('["workflow/w1","openai/g-1","workflow/w1",42,""]')).toEqual(['workflow/w1', 'openai/g-1'])
  })

  it('toggles a pin to the front and back off', () => {
    expect(toggleSeatPin([], 'workflow/w1')).toEqual(['workflow/w1'])
    expect(toggleSeatPin(['a'], 'b')).toEqual(['b', 'a'])
    expect(toggleSeatPin(['b', 'a'], 'b')).toEqual(['a'])
  })

  it('keeps one stable storage key', () => {
    expect(SEAT_PINS_STORAGE_KEY).toContain('workflow')
  })
})
