/** Width clamps for the run-record split panes. Pure functions (testable). */

export const RUN_LIST_MIN_WIDTH = 200
export const RUN_LIST_MAX_WIDTH = 560
export const RUN_LIST_DEFAULT_WIDTH = 320
export const RUN_DETAIL_MIN_WIDTH = 480
export const RUN_NARRATIVE_MIN_WIDTH = 240
export const RUN_NARRATIVE_MAX_WIDTH = 560
export const RUN_NARRATIVE_DEFAULT_WIDTH = 320
export const RUN_RESIZE_STEP_PX = 24
export const RUN_LIST_WIDTH_STORAGE_KEY = 'dsw.runs.listWidth'
export const RUN_NARRATIVE_WIDTH_STORAGE_KEY = 'dsw.runs.narrativeWidth'

/**
 * Clamp the left run-list column width so the detail pane keeps room for the
 * graph. `containerWidth` is the `.workflow-runs` content width in px.
 */
export function clampListWidth(
  width: number,
  containerWidth: number,
  detailMinWidth: number = RUN_DETAIL_MIN_WIDTH,
): number {
  const max = Math.min(
    RUN_LIST_MAX_WIDTH,
    Math.max(RUN_LIST_MIN_WIDTH, containerWidth - detailMinWidth),
  )
  if (Number.isNaN(width)) return Math.min(RUN_LIST_DEFAULT_WIDTH, max)
  return Math.min(max, Math.max(RUN_LIST_MIN_WIDTH, Math.round(width)))
}

/**
 * Clamp the narrative column width inside the detail pane (Option C). Keeps a
 * minimum for the graph stage so the DAG never collapses.
 */
export function clampNarrativeWidth(
  width: number,
  detailWidth: number,
  graphMinWidth: number = 280,
): number {
  const max = Math.min(
    RUN_NARRATIVE_MAX_WIDTH,
    Math.max(RUN_NARRATIVE_MIN_WIDTH, detailWidth - graphMinWidth),
  )
  if (Number.isNaN(width)) return Math.min(RUN_NARRATIVE_DEFAULT_WIDTH, max)
  return Math.min(max, Math.max(RUN_NARRATIVE_MIN_WIDTH, Math.round(width)))
}
