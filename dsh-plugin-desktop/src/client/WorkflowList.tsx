import { useState, useEffect, useCallback, type ReactNode } from 'react'
import {
  BarChart3,
  BookmarkPlus,
  Copy,
  Eye,
  EyeOff,
  Pencil,
  Play,
  Power,
  PowerOff,
  Trash2,
} from 'lucide-react'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import type { Workflow } from './workflow-store.js'
import type { DesktopWorkflowApi, WorkflowStatsSummaryView } from './desktop-workflow-api.js'
import { platformOnlySteps, workflowViewToYaml } from './desktop-workflow-api.js'
import {
  buildRunParams,
  currentWorkspaceId,
  needsProblemParam,
} from './workflow-run-params.js'
import { ensureWorkflowDependencies } from './workflow-deps-ensure.js'
import { formatDependencyIssues } from './workflow-deps.js'
import { WorkflowPreview } from './WorkflowPreview.js'
import { ensureActiveRunCapacity } from './workflow-active-run.js'
import { cloneTemplateYaml } from './workflow-template-clone.js'

interface WorkflowListProps {
  api: DesktopWorkflowApi
  onCreate: () => void
  onEdit: (workflow: Workflow) => void
  /** Open the editor with cloned YAML (same path as template copy). */
  onCopy: (yaml: string) => void
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

function ActionLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <>
      {icon}
      <span>{children}</span>
    </>
  )
}

export function WorkflowList({
  api,
  onCreate,
  onEdit,
  onCopy,
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
  const [message, setMessage] = useState<string | null>(null)
  const [busyName, setBusyName] = useState<string | null>(null)
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
      setMessage(null)
      await api.deleteWorkflow(name)
      if (bindingName === name) setBindingName(null)
      setWorkflows(workflows.filter((w) => w.name !== name))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    }
  }

  const handleCopy = async (workflow: Workflow) => {
    setBusyName(workflow.name)
    setError(null)
    setMessage(null)
    try {
      const cloned = cloneTemplateYaml(
        workflowViewToYaml(workflow),
        workflows.map((entry) => entry.name),
      )
      onCopy(cloned.yaml)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workflowCopyFailed'))
    } finally {
      setBusyName(null)
    }
  }

  const handlePromoteTemplate = async (workflow: Workflow) => {
    setBusyName(workflow.name)
    setError(null)
    setMessage(null)
    try {
      const saved = await api.promoteWorkflowToTemplate(workflow.name, {
        name: workflow.title || workflow.name,
        description: workflow.description || '',
        category: 'custom',
      })
      setMessage(t('workflowPromoted').replace('{name}', saved.name))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workflowPromoteFailed'))
    } finally {
      setBusyName(null)
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
      {message && <div className="workflow-success">{message}</div>}

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
          {workflows.map((workflow) => {
            const isBound = bindingName === workflow.name
            const isBusy = busyName === workflow.name
            const isPreviewing = previewWorkflow?.name === workflow.name
            const platformOnly = platformOnlySteps(workflow)
            const cannotRun = platformOnly.length > 0 || isBusy
            return (
              <div key={workflow.name} className="workflow-card">
                <div className="workflow-card-main">
                  <div className="workflow-card-header">
                    <div className="workflow-card-titles">
                      <h3>{workflow.title || workflow.name}</h3>
                      <span className="workflow-card-name">{workflow.name}</span>
                    </div>
                    {isBound && (
                      <span className="workflow-bound-badge">{t('enabled')}</span>
                    )}
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
                  </div>
                </div>

                <aside className="workflow-card-aside">
                  <div className="workflow-card-actions-primary" role="group" aria-label={t('workflowPrimaryActions')}>
                    <button
                      className="workflow-btn small icon-btn primary"
                      onClick={() => void handleRun(workflow)}
                      disabled={cannotRun}
                      title={platformOnly.length > 0 ? `${t('awfPlatformOnly')} ${platformOnly.join(', ')}` : undefined}
                    >
                      <ActionLabel icon={<Play size={14} aria-hidden />}>{t('run')}</ActionLabel>
                    </button>
                    <button className="workflow-btn small icon-btn" onClick={() => onEdit(workflow)}>
                      <ActionLabel icon={<Pencil size={14} aria-hidden />}>{t('edit')}</ActionLabel>
                    </button>
                    {isBound ? (
                      <button className="workflow-btn small icon-btn" onClick={() => void handleDisable()}>
                        <ActionLabel icon={<PowerOff size={14} aria-hidden />}>{t('disableWorkflow')}</ActionLabel>
                      </button>
                    ) : (
                      <button
                        className="workflow-btn small icon-btn"
                        onClick={() => void handleEnable(workflow)}
                        title={t('enableForWorkspace')}
                      >
                        <ActionLabel icon={<Power size={14} aria-hidden />}>{t('enableShort')}</ActionLabel>
                      </button>
                    )}
                  </div>

                  <div className="workflow-card-actions-secondary" role="group" aria-label={t('workflowSecondaryActions')}>
                    <button
                      className="workflow-btn small icon-btn ghost"
                      onClick={() => setPreviewWorkflow(isPreviewing ? null : workflow)}
                    >
                      <ActionLabel icon={isPreviewing ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}>
                        {isPreviewing ? t('previewHide') : t('preview')}
                      </ActionLabel>
                    </button>
                    {onOpenStats && (
                      <button
                        className="workflow-btn small icon-btn ghost"
                        onClick={() => onOpenStats(workflow.name)}
                      >
                        <ActionLabel icon={<BarChart3 size={14} aria-hidden />}>{t('statsOpen')}</ActionLabel>
                      </button>
                    )}
                    <button
                      className="workflow-btn small icon-btn ghost"
                      disabled={isBusy}
                      onClick={() => { void handleCopy(workflow) }}
                    >
                      <ActionLabel icon={<Copy size={14} aria-hidden />}>
                        {isBusy ? t('loading') : t('workflowCopy')}
                      </ActionLabel>
                    </button>
                    <button
                      className="workflow-btn small icon-btn ghost"
                      disabled={isBusy}
                      onClick={() => { void handlePromoteTemplate(workflow) }}
                      title={t('workflowPromoteHint')}
                    >
                      <ActionLabel icon={<BookmarkPlus size={14} aria-hidden />}>{t('workflowPromote')}</ActionLabel>
                    </button>
                    <button
                      className="workflow-btn small icon-btn danger"
                      onClick={() => void handleDelete(workflow.name)}
                    >
                      <ActionLabel icon={<Trash2 size={14} aria-hidden />}>{t('delete')}</ActionLabel>
                    </button>
                  </div>
                </aside>
              </div>
            )
          })}
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
