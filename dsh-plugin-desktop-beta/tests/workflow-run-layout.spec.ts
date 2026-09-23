import { describe, expect, it } from 'vitest'
import {
  clampListWidth,
  clampNarrativeWidth,
  RUN_LIST_DEFAULT_WIDTH,
  RUN_LIST_MAX_WIDTH,
  RUN_LIST_MIN_WIDTH,
  RUN_NARRATIVE_DEFAULT_WIDTH,
  RUN_NARRATIVE_MAX_WIDTH,
  RUN_NARRATIVE_MIN_WIDTH,
} from '../src/client/workflow-run-layout.ts'

describe('clampListWidth', () => {
  it('clamps to the declared bounds', () => {
    expect(clampListWidth(RUN_LIST_MIN_WIDTH - 40, 1200)).toBe(RUN_LIST_MIN_WIDTH)
    expect(clampListWidth(RUN_LIST_MAX_WIDTH + 40, 1200)).toBe(RUN_LIST_MAX_WIDTH)
    expect(clampListWidth(320, 1200)).toBe(320)
  })

  it('never eats into the detail pane minimum', () => {
    // 900px container - 480px detail min => list max is 420.
    expect(clampListWidth(RUN_LIST_MAX_WIDTH, 900)).toBe(420)
    // Tiny container: list collapses to its own floor.
    expect(clampListWidth(RUN_LIST_DEFAULT_WIDTH, 600)).toBe(RUN_LIST_MIN_WIDTH)
  })

  it('rounds and rejects non-finite input', () => {
    expect(clampListWidth(320.6, 1200)).toBe(321)
    expect(clampListWidth(Number.NaN, 1200)).toBe(RUN_LIST_DEFAULT_WIDTH)
    expect(clampListWidth(Number.POSITIVE_INFINITY, 1200)).toBe(RUN_LIST_MAX_WIDTH)
  })
})

describe('clampNarrativeWidth', () => {
  it('clamps to the declared bounds', () => {
    expect(clampNarrativeWidth(RUN_NARRATIVE_MIN_WIDTH - 10, 900)).toBe(RUN_NARRATIVE_MIN_WIDTH)
    expect(clampNarrativeWidth(RUN_NARRATIVE_MAX_WIDTH + 10, 900)).toBe(RUN_NARRATIVE_MAX_WIDTH)
    expect(clampNarrativeWidth(320, 900)).toBe(320)
  })

  it('keeps the graph stage above its minimum', () => {
    // 700px detail - 280px graph min => narrative max is 420.
    expect(clampNarrativeWidth(RUN_NARRATIVE_MAX_WIDTH, 700)).toBe(420)
    expect(clampNarrativeWidth(RUN_NARRATIVE_MAX_WIDTH, 400)).toBe(RUN_NARRATIVE_MIN_WIDTH)
  })

  it('rejects non-finite input', () => {
    expect(clampNarrativeWidth(Number.NaN, 900)).toBe(RUN_NARRATIVE_DEFAULT_WIDTH)
  })
})
