import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopWorkflowApi } from './desktop-workflow-api.js'
import {
  getArmedWorkflow,
  setArmedWorkflow,
  subscribeArmedWorkflow,
} from './workflow-arm.js'
import {
  buildRunParams,
  currentWorkspaceId,
  needsProblemParam,
  pickSessionCwd,
} from './workflow-run-params.js'
import {
  ensureWorkflowDependencies,
  resolveWorkflowForDeps,
} from './workflow-deps-ensure.js'
import { formatDependencyIssues } from './workflow-deps.js'
import { ensureActiveRunCapacity } from './workflow-active-run.js'

export type WorkflowRecommendProps = PropsRuntime<'conversation.input.right'>
  & PropsLocale<'dsh-plugin-desktop/workflow'>
  & {
    api: DesktopWorkflowApi
    openRunsPanel: () => void
    openWorkflowPanel: () => void
    openSettingsPanel: () => void
  }

/** Mark the composer card so CSS can distinguish workflow vs model mode. */
function syncComposerModeAttr(armed: boolean): void {
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

/**
 * Composer submit actions for the armed workflow. Selection lives in the
 * unified model/workflow seat (which also arms the picked workflow); this
 * control renders only the armed actions — 「用工作流发送」submits the composer
 * draft as a workflow run, 「模型」returns to plain model chat.
 */
export function WorkflowRecommend({
  api,
  t,
  useInput,
  useSessions,
  sessionId,
  inputActions,
  openRunsPanel,
  openSettingsPanel,
}: WorkflowRecommendProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const workspaceId = currentWorkspaceId()
  const armed = useSyncExternalStore(subscribeArmedWorkflow, getArmedWorkflow, getArmedWorkflow)
  const draft = useInput((state) => state.draft)
  const sessionCwd = useSessions((state) => pickSessionCwd(state, sessionId))

  useEffect(() => {
    syncComposerModeAttr(armed != null)
    return () => syncComposerModeAttr(false)
  }, [armed])

  const sendArmed = async (): Promise<void> => {
    const candidate = getArmedWorkflow()
    if (!candidate) return
    const prompt = draft.trim()
    if (!prompt) {
      setError(t('recommendPromptRequired'))
      return
    }

    setBusy(true)
    setError(null)
    try {
      const canStart = await ensureActiveRunCapacity({
        api,
        confirmStop: (message) => window.confirm(message),
        atCapacityMessage: t('runAtCapacity'),
      })
      if (!canStart) return

      const workflow = await resolveWorkflowForDeps(api, {
        workflowName: candidate.workflowName,
        templateYaml: candidate.templateYaml,
        source: candidate.source,
      })

      const { proceed, report } = await ensureWorkflowDependencies({
        api,
        workflow,
        prompt,
        requirePrompt: needsProblemParam(workflow) || candidate.needsProblem,
        incompleteTitle: t('depsIncompleteTitle'),
        openSettingsLabel: t('depsOpenSettings'),
        continueLabel: t('depsContinueAnyway'),
        confirm: (message) => window.confirm(message),
      })

      if (report.issues.some((issue) => issue.blocking)) {
        setError(`${t('depsBlocked')}\n${formatDependencyIssues(report.issues.filter((i) => i.blocking))}`)
        return
      }
      if (!proceed) {
        openSettingsPanel()
        return
      }

      const params = buildRunParams(workspaceId, prompt, sessionCwd)
      if (candidate.source === 'enabled') {
        await api.startBoundRun(workspaceId, params)
      } else {
        await api.startRun(workflow.name, params)
      }
      setArmedWorkflow(null)
      inputActions?.setDraft('')
      openRunsPanel()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('recommendRunFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (!armed) return null
  return (
    <span className="dshWorkflowRecommend dshWorkflowRecommend--armed" data-mode="workflow">
      {error !== null && <span className="dshWorkflowRecommendMeta">{error}</span>}
      <Button
        variant="ghost"
        className="dshWorkflowRecommendClear"
        disabled={busy}
        aria-label={t('recommendClear')}
        onClick={() => setArmedWorkflow(null)}
      >
        {t('modeModelShort')}
      </Button>
      <Button
        variant="ghost"
        className="dshWorkflowRecommendSend"
        disabled={busy || !draft.trim()}
        aria-label={t('recommendSend')}
        onClick={() => void sendArmed()}
      >
        {t('recommendSend')}
      </Button>
    </span>
  )
}
