import { describe, expect, it, vi } from 'vitest'
import { resolveLayout, selectWorkflowPanel } from '../src/client/workflow-layout.ts'

describe('workflow layout selection', () => {
  it('prefers ctx.get(layout) and calls selectPanel(workflow)', () => {
    const layout = { selectPanel: vi.fn() }
    const ctx = {
      get: vi.fn(() => layout),
      reflect: { get: vi.fn(() => undefined) },
    }
    selectWorkflowPanel(ctx as never)
    expect(layout.selectPanel).toHaveBeenCalledExactlyOnceWith('workflow')
    expect(ctx.reflect.get).not.toHaveBeenCalled()
  })

  it('falls back to reflect.get when ctx.get is empty', () => {
    const layout = { selectPanel: vi.fn() }
    const ctx = {
      get: vi.fn(() => undefined),
      reflect: { get: vi.fn(() => layout) },
    }
    expect(resolveLayout(ctx as never)).toBe(layout)
    selectWorkflowPanel(ctx as never)
    expect(layout.selectPanel).toHaveBeenCalledExactlyOnceWith('workflow')
  })

  it('swallows selectPanel registration errors without throwing', () => {
    const layout = {
      selectPanel: vi.fn(() => {
        throw new Error('main panel "workflow" is not registered')
      }),
    }
    const ctx = {
      get: vi.fn(() => layout),
      reflect: { get: vi.fn(() => undefined) },
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => selectWorkflowPanel(ctx as never)).not.toThrow()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
