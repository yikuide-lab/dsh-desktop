/** Width clamps and persisted state for the workflow AWF side rail. */

export const AWF_RAIL_MIN_WIDTH = 280
export const AWF_RAIL_MAX_WIDTH = 560
export const AWF_RAIL_DEFAULT_WIDTH = 360
export const AWF_RAIL_COLLAPSED_WIDTH = 40
export const AWF_RAIL_WIDTH_STORAGE_KEY = 'dsw.workflow.awfRailWidth'
export const AWF_RAIL_OPEN_STORAGE_KEY = 'dsw.workflow.awfRailOpen'

/**
 * Clamp the AWF rail width so the tab content beside it keeps room to work.
 * `containerWidth` is the `.workflow-body` content width in px.
 */
export function clampAwfRailWidth(
  width: number,
  containerWidth: number,
  contentMinWidth: number = 360,
): number {
  const max = Math.min(
    AWF_RAIL_MAX_WIDTH,
    Math.max(AWF_RAIL_MIN_WIDTH, containerWidth - contentMinWidth),
  )
  if (Number.isNaN(width)) return Math.min(AWF_RAIL_DEFAULT_WIDTH, max)
  return Math.min(max, Math.max(AWF_RAIL_MIN_WIDTH, Math.round(width)))
}
