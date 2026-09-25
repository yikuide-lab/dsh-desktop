/** Shared send path for an armed composer workflow. */

import type { DesktopWorkflowApi } from './desktop-workflow-api.js'
import { getArmedWorkflow, setArmedWorkflow } from './workflow-arm.js'
import {
  buildRunParams,
  currentWorkspaceId,
  needsProblemParam,
} from './workflow-run-params.js'
import {
  ensureWorkflowDependencies,
  resolveWorkflowForDeps,
} from './workflow-deps-ensure.js'
import { formatDependencyIssues } from './workflow-deps.js'
import { ensureActiveRunCapacity } from './workflow-active-run.js'
import type { WorkflowLocaleKey } from './locales-workflow.js'

/** Mark the composer card so CSS can distinguish workflow vs model mode. */
export function syncComposerArmedAttr(armed: boolean): void {
  try {
    const cards = document.querySelectorAll('[data-composer-card]')
    for (const card of cards) {
      if (armed) card.setAttribute('data-workflow-armed', 'true')
      else card.removeAttribute('data-workflow-armed')
    }
  } catch {
    // DOM may be unavailable in tests / SSR-like hosts.
  }
}

export interface ArmedWorkflowSendInput {
  api: DesktopWorkflowApi
  prompt: string
  sessionCwd: string | undefined
  t: (key: WorkflowLocaleKey) => string
  confirmStop: (message: string) => boolean
  confirmDeps: (message: string) => boolean
  openSettingsPanel: () => void
  openRunsPanel: () => void
  clearDraft: () => void
}

export type ArmedWorkflowSendResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Submit the composer draft as a run of the currently armed workflow.
 * Clears the arm and draft on success; returns a localized error otherwise.
 */
export async function sendArmedWorkflow(
  input: ArmedWorkflowSendInput,
): Promise<ArmedWorkflowSendResult> {
  const candidate = getArmedWorkflow()
  if (!candidate) return { ok: false, error: input.t('recommendRunFailed') }
  const prompt = input.prompt.trim()
  if (!prompt) return { ok: false, error: input.t('recommendPromptRequired') }

  try {
    const canStart = await ensureActiveRunCapacity({
      api: input.api,
      confirmStop: input.confirmStop,
      atCapacityMessage: input.t('runAtCapacity'),
    })
    if (!canStart) return { ok: false, error: input.t('runAtCapacity') }

    const workflow = await resolveWorkflowForDeps(input.api, {
      workflowName: candidate.workflowName,
      templateYaml: candidate.templateYaml,
      source: candidate.source,
    })

    const { proceed, report } = await ensureWorkflowDependencies({
      api: input.api,
      workflow,
      prompt,
      requirePrompt: needsProblemParam(workflow) || candidate.needsProblem,
      incompleteTitle: input.t('depsIncompleteTitle'),
      openSettingsLabel: input.t('depsOpenSettings'),
      continueLabel: input.t('depsContinueAnyway'),
      confirm: input.confirmDeps,
    })

    if (report.issues.some(issue => issue.blocking)) {
      return {
        ok: false,
        error: `${input.t('depsBlocked')}\n${formatDependencyIssues(report.issues.filter(i => i.blocking))}`,
      }
    }
    if (!proceed) {
      input.openSettingsPanel()
      return { ok: false, error: input.t('depsIncompleteTitle') }
    }

    const params = buildRunParams(currentWorkspaceId(), prompt, input.sessionCwd)
    if (candidate.source === 'enabled') {
      await input.api.startBoundRun(currentWorkspaceId(), params)
    } else {
      await input.api.startRun(workflow.name, params)
    }
    setArmedWorkflow(null)
    input.clearDraft()
    input.openRunsPanel()
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : input.t('recommendRunFailed'),
    }
  }
}
