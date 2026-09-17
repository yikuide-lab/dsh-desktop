import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  Button,
  Menu,
  Tooltip,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopWorkflowApi } from './desktop-workflow-api.js'
import { WorkflowIcon } from './WorkflowLauncher.js'
import {
  buildRecommendCandidates,
  type WorkflowRecommendCandidate,
} from './workflow-recommend-candidates.js'
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
 * Compact composer control: arm a workflow (mutually exclusive with plain model chat).
 * Submitting uses the "用工作流发送" action with the composer draft as PROMPT.
 */
export function WorkflowRecommend({
  api,
  t,
  useInput,
  useSessions,
  sessionId,
  inputActions,
  openRunsPanel,
  openWorkflowPanel,
  openSettingsPanel,
}: WorkflowRecommendProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<WorkflowRecommendCandidate[]>([])
  const workspaceId = currentWorkspaceId()
  const armed = useSyncExternalStore(subscribeArmedWorkflow, getArmedWorkflow, getArmedWorkflow)
  const draft = useInput((state) => state.draft)
  const sessionCwd = useSessions((state) => pickSessionCwd(state, sessionId))

  useEffect(() => {
    syncComposerModeAttr(armed != null)
    return () => syncComposerModeAttr(false)
  }, [armed])

  const loadCandidates = useCallback(async () => {
    setError(null)
    try {
      const [workflows, templates, binding] = await Promise.all([
        api.listWorkflows(),
        api.listTemplates(),
        api.getBinding(workspaceId),
      ])
      setCandidates(buildRecommendCandidates({
        bindingName: binding?.workflowName ?? null,
        workflows,
        templates,
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
      setCandidates([])
    }
  }, [api, t, workspaceId])

  useEffect(() => {
    void loadCandidates()
  }, [loadCandidates])

  useEffect(() => {
    if (!open) return
    void loadCandidates()
  }, [open, loadCandidates])

  const sourceLabel = useCallback((source: WorkflowRecommendCandidate['source']): string => {
    if (source === 'enabled') return t('recommendEnabled')
    if (source === 'template') return t('recommendTemplate')
    return t('recommendSaved')
  }, [t])

  const items = useMemo((): MenuEntry[] => {
    if (candidates.length === 0) {
      return [{
        id: 'empty',
        label: error ?? t('recommendEmpty'),
        disabled: true,
      }]
    }
    return candidates.map((candidate) => ({
      id: candidate.id,
      label: (
        <span className="dshWorkflowRecommendItem">
          <span className="dshWorkflowRecommendTitle">{candidate.title}</span>
          <span className="dshWorkflowRecommendMeta">{sourceLabel(candidate.source)}</span>
        </span>
      ),
    }))
  }, [candidates, error, sourceLabel, t])

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

  const triggerLabel = armed
    ? `${t('modeWorkflowShort')} · ${armed.title || armed.workflowName}`
    : t('modeSwitchToWorkflow')

  return (
    <span
      className={`dshWorkflowRecommend${armed ? ' dshWorkflowRecommend--armed' : ' dshWorkflowRecommend--model'}`}
      data-mode={armed ? 'workflow' : 'model'}
    >
      <span
        className={`dshWorkflowModeIdleBadge${armed ? ' dshWorkflowModeIdleBadge--workflow' : ''}`}
        aria-hidden="true"
      >
        {armed ? t('modeWorkflowShort') : t('modeModelShort')}
      </span>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(id) => {
          setOpen(false)
          if (id === 'empty') return
          if (id === 'open-panel') {
            openWorkflowPanel()
            return
          }
          if (id === 'clear-arm') {
            setArmedWorkflow(null)
            return
          }
          const next = candidates.find((entry) => entry.id === id)
          if (next) setArmedWorkflow(next)
        }}
        side="top"
        align="end"
        portal
        compact
        selection="fill"
        selectedId={armed?.id}
        items={items}
        footer={[
          ...(armed ? [{ id: 'clear-arm', label: t('recommendClear') }] : []),
          { id: 'open-panel', label: t('recommendOpenPanel') },
        ]}
        anchor={(
          <Tooltip
            label={error ?? (armed ? t('recommendArmedHint') : t('modeSwitchHint'))}
            delayMs={500}
            disabled={open}
          >
            <Button
              variant="ghost"
              className="dshWorkflowRecommendTrigger"
              aria-label={armed ? t('modeWorkflow') : t('modeSwitchToWorkflow')}
              aria-expanded={open}
              disabled={busy}
              data-active={open || armed ? true : undefined}
              data-mode={armed ? 'workflow' : 'model'}
              icon={<WorkflowIcon size={14} />}
              onClick={() => setOpen((value) => !value)}
            >
              {triggerLabel}
            </Button>
          </Tooltip>
        )}
      />
      {armed && (
        <>
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
        </>
      )}
    </span>
  )
}
