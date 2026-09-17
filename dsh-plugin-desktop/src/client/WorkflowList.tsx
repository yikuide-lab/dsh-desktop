import { useState, useEffect, useCallback } from 'react'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import type { Workflow } from './workflow-store.js'
import type { DesktopWorkflowApi, WorkflowStatsSummaryView } from './desktop-workflow-api.js'
import { platformOnlySteps } from './desktop-workflow-api.js'
import {
  buildRunParams,
  currentWorkspaceId,
  needsProblemParam,
} from './workflow-run-params.js'
import { ensureWorkflowDependencies } from './workflow-deps-ensure.js'
import { formatDependencyIssues } from './workflow-deps.js'
import { WorkflowPreview } from './WorkflowPreview.js'
import { ensureActiveRunCapacity } from './workflow-active-run.js'

interface WorkflowListProps {
  api: DesktopWorkflowApi
  onCreate: () => void
  onEdit: (workflow: Workflow) => void
  onRunStarted: () => void
  onOpenSettings?: () => void
  onOpenStats?: (workflowName: string) => void
  /** Absolute session cwd when available (preferred over URL heuristics). */
  sessionCwd?: string | undefined
  t: (key: WorkflowLocaleKey) => string
}

function formatRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '0%'
  return `${Math.round(rate * 1000) / 10}%`
}

export function WorkflowList({
  api,
  onCreate,
  onEdit,
  onRunStarted,
  onOpenSettings,
  onOpenStats,
  sessionCwd,
  t,
}: WorkflowListProps) {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [statsByName, setStatsByName] = useState<Record<string, WorkflowStatsSummaryView>>({})
  const [bindingName, setBindingName] = useState<string | null>(null)
  const [previewWorkflow, setPreviewWorkflow] = useState<Workflow | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const workspaceId = currentWorkspaceId()

  const loadWorkflows = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [list, binding, stats] = await Promise.all([
        api.listWorkflows(),
        api.getBinding(workspaceId),
        api.getWorkflowStats().catch(() => [] as WorkflowStatsSummaryView[]),
      ])
      setWorkflows(list)
      setBindingName(binding?.workflowName ?? null)
      const next: Record<string, WorkflowStatsSummaryView> = {}
      for (const entry of stats) next[entry.workflowName] = entry
      setStatsByName(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setIsLoading(false)
    }
  }, [api, t, workspaceId])

  useEffect(() => {
    void loadWorkflows()
  }, [loadWorkflows])

  const handleDelete = async (name: string) => {
    if (!confirm(t('confirmDelete'))) return
    try {
      setError(null)
      await api.deleteWorkflow(name)
      if (bindingName === name) setBindingName(null)
      setWorkflows(workflows.filter((w) => w.name !== name))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    }
  }

  const handleRun = async (workflow: Workflow) => {
    try {
      setError(null)
      // 能力协商（awf-66p）：含平台扩展类型的本地工作流诚实拒绝运行（同步到 AWF 不受限）
      const platformOnly = platformOnlySteps(workflow)
      if (platformOnly.length > 0) {
        setError(`${t('awfPlatformOnly')} ${platformOnly.join(', ')}`)
        return
      }
      const canStart = await ensureActiveRunCapacity({
        api,
        confirmStop: (message) => window.confirm(message),
        atCapacityMessage: t('runAtCapacity'),
      })
      if (!canStart) return

      let problem: string | undefined
      if (needsProblemParam(workflow)) {
        const input = window.prompt(t('problemPrompt'), '')
        if (input === null) return
        const trimmed = input.trim()
        if (!trimmed) {
          setError(t('problemRequired'))
          return
        }
        problem = trimmed
      }

      const { proceed, report } = await ensureWorkflowDependencies({
        api,
        workflow,
        prompt: problem,
        requirePrompt: needsProblemParam(workflow),
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
        onOpenSettings?.()
        return
      }

      await api.startRun(workflow.name, buildRunParams(workspaceId, problem, sessionCwd))
      onRunStarted()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    }
  }

  const handleEnable = async (workflow: Workflow) => {
    try {
      setError(null)
      await api.setBinding(workspaceId, workflow.name)
      setBindingName(workflow.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    }
  }

  const handleDisable = async () => {
    try {
      setError(null)
      await api.clearBinding(workspaceId)
      setBindingName(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    }
  }

  const handleStartBound = async () => {
    try {
      setError(null)
      const canStart = await ensureActiveRunCapacity({
        api,
        confirmStop: (message) => window.confirm(message),
        atCapacityMessage: t('runAtCapacity'),
      })
      if (!canStart) return

      let problem: string | undefined
      const bound = bindingName
        ? workflows.find((workflow) => workflow.name === bindingName)
        : undefined
      if (bound && needsProblemParam(bound)) {
        const input = window.prompt(t('problemPrompt'), '')
        if (input === null) return
        const trimmed = input.trim()
        if (!trimmed) {
          setError(t('problemRequired'))
          return
        }
        problem = trimmed
      }
      if (bound) {
        const { proceed, report } = await ensureWorkflowDependencies({
          api,
          workflow: bound,
          prompt: problem,
          requirePrompt: needsProblemParam(bound),
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
          onOpenSettings?.()
          return
        }
      }
      await api.startBoundRun(workspaceId, buildRunParams(workspaceId, problem, sessionCwd))
      onRunStarted()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    }
  }

  if (isLoading && workflows.length === 0) {
    return <div className="workflow-loading">{t('loading')}</div>
  }

  return (
    <div className="workflow-list">
      {error && (
        <div className="workflow-error">
          <p>{error}</p>
          <button className="workflow-btn" onClick={() => void loadWorkflows()}>{t('retry')}</button>
        </div>
      )}

      <div className="workflow-list-header">
        <button className="workflow-btn primary" onClick={onCreate}>
          {t('create')}
        </button>
        {bindingName && (
          <div className="workflow-binding-banner">
            <span>{t('enabledForWorkspace')}: <strong>{bindingName}</strong></span>
            <button className="workflow-btn small primary" onClick={() => void handleStartBound()}>
              {t('runEnabled')}
            </button>
            <button className="workflow-btn small" onClick={() => void handleDisable()}>
              {t('disableWorkflow')}
            </button>
          </div>
        )}
      </div>

      {workflows.length === 0 ? (
        <div className="workflow-empty">
          <h3>{t('noWorkflows')}</h3>
          <p>{t('noWorkflowsBody')}</p>
        </div>
      ) : (
        <div className="workflow-grid">
          {workflows.map((workflow) => (
            <div key={workflow.name} className="workflow-card">
              <div className="workflow-card-header">
                <h3>{workflow.title || workflow.name}</h3>
                <span className="workflow-card-name">{workflow.name}</span>
              </div>
              {workflow.description && (
                <p className="workflow-card-description">{workflow.description}</p>
              )}
              <div className="workflow-card-meta">
                <span>{workflow.steps.length} {t('steps')}</span>
                {statsByName[workflow.name] && (
                  <span className="workflow-stats-chip">
                    {statsByName[workflow.name]!.totalRuns} {t('statsRuns')}
                    {' · '}
                    {formatRate(statsByName[workflow.name]!.successRate)}
                  </span>
                )}
                {bindingName === workflow.name && (
                  <span className="workflow-bound-badge">{t('enabled')}</span>
                )}
              </div>
              <div className="workflow-card-actions">
                <button
                  className="workflow-btn small"
                  onClick={() => setPreviewWorkflow(
                    previewWorkflow?.name === workflow.name ? null : workflow,
                  )}
                >
                  {previewWorkflow?.name === workflow.name ? t('previewHide') : t('preview')}
                </button>
                <button className="workflow-btn small" onClick={() => onEdit(workflow)}>
                  {t('edit')}
                </button>
                <button
                  className="workflow-btn small primary"
                  onClick={() => void handleRun(workflow)}
                  disabled={platformOnlySteps(workflow).length > 0}
                  title={platformOnlySteps(workflow).length > 0 ? `${t('awfPlatformOnly')} ${platformOnlySteps(workflow).join(', ')}` : undefined}
                >
                  {t('run')}
                </button>
                {onOpenStats && (
                  <button
                    className="workflow-btn small"
                    onClick={() => onOpenStats(workflow.name)}
                  >
                    {t('statsOpen')}
                  </button>
                )}
                {bindingName === workflow.name ? (
                  <button className="workflow-btn small" onClick={() => void handleDisable()}>
                    {t('disableWorkflow')}
                  </button>
                ) : (
                  <button className="workflow-btn small" onClick={() => void handleEnable(workflow)}>
                    {t('enableForWorkspace')}
                  </button>
                )}
                <button
                  className="workflow-btn small danger"
                  onClick={() => void handleDelete(workflow.name)}
                >
                  {t('delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {previewWorkflow && (
        <div className="workflow-list-preview">
          <WorkflowPreview
            key={previewWorkflow.name}
            workflow={previewWorkflow}
            title={previewWorkflow.title || previewWorkflow.name}
            t={t}
            defaultMode="visual"
          />
        </div>
      )}
    </div>
  )
}
