import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'

export const WORKFLOW_PANEL_ID = 'workflow' as MainPanelId

type LayoutSelect = { selectPanel(panelId: MainPanelId | null): void }

/** Resolve the live layout service without requiring it in this plugin's inject list. */
export function resolveLayout(ctx: ClientContext): LayoutSelect | undefined {
  const fromGet = ctx.get('layout') as LayoutSelect | undefined
  if (fromGet?.selectPanel) return fromGet
  const fromReflect = ctx.reflect.get('layout', false) as LayoutSelect | undefined
  if (fromReflect?.selectPanel) return fromReflect
  return undefined
}

/** Open the workflow main panel; log clearly when layout or registration is missing. */
export function selectWorkflowPanel(ctx: ClientContext): void {
  const layout = resolveLayout(ctx)
  if (!layout) {
    console.error('[dsh-plugin-desktop/workflow] layout service is unavailable')
    return
  }
  try {
    layout.selectPanel(WORKFLOW_PANEL_ID)
  } catch (error) {
    console.error('[dsh-plugin-desktop/workflow] failed to select workflow panel', error)
  }
}
