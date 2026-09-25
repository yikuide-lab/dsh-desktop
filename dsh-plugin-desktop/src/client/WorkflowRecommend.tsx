/**
 * Former `conversation.input.right` submit chip.
 *
 * Armed-workflow send now lives beside the unified seat caption
 * (`WorkflowModelSelect` + `sendArmedWorkflow`). This module stays only so
 * older imports and docs that name `WorkflowRecommend` keep compiling; it
 * renders nothing.
 */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopWorkflowApi } from './desktop-workflow-api.js'

export type WorkflowRecommendProps = PropsRuntime<'conversation.input.right'>
  & PropsLocale<'dsh-plugin-desktop/workflow'>
  & {
    api: DesktopWorkflowApi
    openRunsPanel: () => void
    openWorkflowPanel: () => void
    openSettingsPanel: () => void
  }

/** @deprecated Send lives on the model seat; this slot occupant is a no-op. */
export function WorkflowRecommend(_props: WorkflowRecommendProps) {
  return null
}

export { sendArmedWorkflow, syncComposerArmedAttr } from './workflow-armed-send.js'
