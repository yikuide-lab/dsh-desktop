import { describe, expect, it } from 'vitest'
import {
  canDesignRedo,
  canDesignUndo,
  createDesignHistory,
  currentDesignRevision,
  ensureDesignBaseline,
  jumpDesignRevision,
  pushDesignRevision,
  redoDesignRevision,
  undoDesignRevision,
} from '../src/client/workflow-design-history.ts'

describe('workflow design history', () => {
  it('seeds baseline once and supports undo/redo/jump', () => {
    let state = createDesignHistory()
    state = ensureDesignBaseline(state, 'yaml-a', 'baseline')
    state = ensureDesignBaseline(state, 'yaml-ignored', 'baseline')
    expect(state.revisions).toHaveLength(1)

    state = pushDesignRevision(state, { yaml: 'yaml-b', label: 'round-1', prompt: 'add gate' })
    state = pushDesignRevision(state, { yaml: 'yaml-c', label: 'round-2' })
    expect(currentDesignRevision(state)?.yaml).toBe('yaml-c')
    expect(canDesignUndo(state)).toBe(true)
    expect(canDesignRedo(state)).toBe(false)

    state = undoDesignRevision(state)
    expect(currentDesignRevision(state)?.yaml).toBe('yaml-b')
    expect(canDesignRedo(state)).toBe(true)

    state = redoDesignRevision(state)
    expect(currentDesignRevision(state)?.yaml).toBe('yaml-c')

    state = jumpDesignRevision(state, 0)
    expect(currentDesignRevision(state)?.label).toBe('baseline')

    // Push after jump truncates redo branch.
    state = pushDesignRevision(state, { yaml: 'yaml-d', label: 'fork' })
    expect(state.revisions.map((r) => r.yaml)).toEqual(['yaml-a', 'yaml-d'])
    expect(currentDesignRevision(state)?.yaml).toBe('yaml-d')
  })

  it('ignores duplicate yaml pushes', () => {
    let state = ensureDesignBaseline(createDesignHistory(), 'same', 'baseline')
    state = pushDesignRevision(state, { yaml: 'same', label: 'noop' })
    expect(state.revisions).toHaveLength(1)
  })
})
