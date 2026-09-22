import { useState, useEffect, useCallback, useRef } from 'react'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import type { WorkflowRun, PendingGateView, WorkflowViewStore } from './workflow-store.js'
import type { DesktopWorkflowApi, WorkflowTranscriptEventView } from './desktop-workflow-api.js'
import { WorkflowRunGraph } from './WorkflowRunGraph.js'

interface WorkflowRunViewProps {
  api: DesktopWorkflowApi
  t: (key: WorkflowLocaleKey) => string
  useStore?: PropsStore<WorkflowViewStore>['useStore']
  actions?: PropsStore<WorkflowViewStore>['actions']
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'aborted', 'skipped'])

function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status)
}

export function WorkflowRunView({ api, t, useStore, actions }: WorkflowRunViewProps) {
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [selectedRun, setSelectedRun] = useState<WorkflowRun | null>(null)
  const [gates, setGates] = useState<PendingGateView[]>([])
  const [transcript, setTranscript] = useState<WorkflowTranscriptEventView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resolvingGate, setResolvingGate] = useState<string | null>(null)
  const [exportPreview, setExportPreview] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState(false)
  const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph')

  const selectedRunIdRef = useRef<string | null>(null)
  const selectedStatusRef = useRef<string | null>(null)
  const loadRunsRef = useRef<() => Promise<void>>(async () => {})
  const focusRunId = useStore?.((s) => s.focusRunId) ?? null

  useEffect(() => {
    selectedRunIdRef.current = selectedRun?.id ?? null
    selectedStatusRef.current = selectedRun?.status ?? null
  }, [selectedRun?.id, selectedRun?.status])

  const loadRuns = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [list, pending] = await Promise.all([
        api.listRuns(),
        api.listGates(),
      ])
      setRuns(list)
      setGates(pending)
      const selectedId = selectedRunIdRef.current
      if (selectedId) {
        const fresh = list.find(r => r.id === selectedId) ?? null
        setSelectedRun(fresh)
        if (!fresh) {
          setTranscript([])
          selectedStatusRef.current = null
        } else {
          const prevStatus = selectedStatusRef.current
          const becameTerminal = Boolean(
            prevStatus
            && !isTerminalStatus(prevStatus)
            && isTerminalStatus(fresh.status),
          )
          if (!isTerminalStatus(fresh.status) || becameTerminal) {
            const page = await api.getTranscript(fresh.id, { limit: 200 })
            setTranscript(page.events)
          }
          selectedStatusRef.current = fresh.status
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setIsLoading(false)
    }
  }, [api, t])

  loadRunsRef.current = loadRuns

  useEffect(() => {
    void loadRunsRef.current()
    const timer = setInterval(() => { void loadRunsRef.current() }, 2000)
    return () => clearInterval(timer)
  }, [api])

  const selectRun = async (run: WorkflowRun) => {
    selectedRunIdRef.current = run.id
    setSelectedRun(run)
    try {
      const page = await api.getTranscript(run.id, { limit: 200 })
      setTranscript(page.events)
    } catch {
      setTranscript([])
    }
  }

  useEffect(() => {
    if (!focusRunId) return
    const match = runs.find((run) => run.id === focusRunId)
    if (match) {
      void selectRun(match)
      actions?.setFocusRunId(null)
      return
    }
    // Wait until runs load; clear stale ids after a successful load with no match.
    if (!isLoading && runs.length >= 0) {
      void api.getRun(focusRunId).then((run) => {
        if (run) void selectRun(run)
        actions?.setFocusRunId(null)
      }).catch(() => {
        actions?.setFocusRunId(null)
      })
    }
  }, [focusRunId, runs, isLoading, api, actions])
  const handleStop = async (runId: string) => {
    if (!confirm(t('confirmStop'))) return
    try {
      await api.stopRun(runId)
      await loadRuns()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    }
  }

  const handleExport = async (runId: string) => {
    setBusyAction(true)
    setError(null)
    try {
      const exported = await api.exportRun(runId)
      const text = JSON.stringify(exported, null, 2)
      setExportPreview(text)
      const blob = new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${runId}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setBusyAction(false)
    }
  }

  const handleDeleteRun = async (runId: string) => {
    if (!confirm(t('confirmDeleteRun'))) return
    setBusyAction(true)
    setError(null)
    try {
      await api.deleteRun(runId)
      if (selectedRun?.id === runId) {
        selectedRunIdRef.current = null
        setSelectedRun(null)
        setTranscript([])
        setExportPreview(null)
      }
      await loadRuns()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setBusyAction(false)
    }
  }

  const handleResolveGate = async (gate: PendingGateView, decision: string) => {
    const key = `${gate.runId}:${gate.stepId}`
    if (resolvingGate) return
    setResolvingGate(key)
    try {
      const updated = await api.resolveGate({
        runId: gate.runId,
        stepId: gate.stepId,
        decision,
        token: gate.token,
        resolvedBy: 'desktop-user',
      })
      setSelectedRun(updated)
      await loadRuns()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setResolvingGate(null)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#22c55e'
      case 'running': return '#3b82f6'
      case 'failed': return '#ef4444'
      case 'pending': return '#9ca3af'
      case 'skipped': return '#a855f7'
      case 'aborted': return '#f59e0b'
      default: return '#9ca3af'
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed': return t('completed')
      case 'running': return t('running')
      case 'failed': return t('failed')
      case 'pending': return t('pending')
      case 'skipped': return t('skipped')
      case 'aborted': return t('aborted')
      default: return status
    }
  }

  const selectedGates = selectedRun
    ? gates.filter(g => g.runId === selectedRun.id)
    : []

  const progress = selectedRun?.steps?.length
    ? Math.round(
      (selectedRun.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length
        / selectedRun.steps.length) * 100,
    )
    : 0

  if (isLoading && runs.length === 0) {
    return <div className="workflow-loading">{t('loading')}</div>
  }

  return (
    <div className="workflow-runs">
      {error && <div className="workflow-error" role="alert">{error}</div>}
      <div className="workflow-runs-list">
        <div className="workflow-list-header">
          <h3>{t('runs')}</h3>
          <button type="button" className="workflow-btn small" onClick={() => void loadRuns()}>{t('refresh')}</button>
        </div>
        {runs.length === 0 ? (
          <div className="workflow-empty">
            <p>{t('noRuns')}</p>
          </div>
        ) : (
          <div className="workflow-run-cards" role="list">
            {runs.map((run) => (
              <div
                key={run.id}
                role="listitem"
                tabIndex={0}
                className={`workflow-run-card ${selectedRun?.id === run.id ? 'selected' : ''}`}
                aria-selected={selectedRun?.id === run.id}
                onClick={() => { void selectRun(run) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    void selectRun(run)
                  }
                }}
              >
                <div className="workflow-run-header">
                  <span className="workflow-run-name">{run.workflowName}</span>
                  <span className="workflow-run-badges">
                    {run.params?.source === 'openai-api' && (
                      <span className="workflow-run-source-badge">{t('runSourceApi')}</span>
                    )}
                    <span
                      className="workflow-run-status"
                      style={{ backgroundColor: getStatusColor(run.status) }}
                    >
                      {getStatusText(run.status)}
                    </span>
                  </span>
                </div>
                <div className="workflow-run-meta">
                  <span>{run.id}</span>
                  {run.startedAt && (
                    <span>{new Date(run.startedAt).toLocaleString()}</span>
                  )}
                </div>
                {run.status === 'running' && (
                  <button
                    type="button"
                    className="workflow-btn small danger"
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleStop(run.id)
                    }}
                  >
                    {t('stop')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedRun && (
        <div className="workflow-run-detail">
          <div className="workflow-list-header">
            <h3>{t('view')}: {selectedRun.workflowName}</h3>
            <div className="workflow-settings-provider-actions">
              <button
                type="button"
                className="workflow-btn small"
                disabled={busyAction}
                onClick={() => void handleExport(selectedRun.id)}
              >
                {t('runExport')}
              </button>
              <button
                type="button"
                className="workflow-btn small danger"
                disabled={busyAction}
                onClick={() => void handleDeleteRun(selectedRun.id)}
              >
                {t('runDelete')}
              </button>
            </div>
          </div>
          <div className="workflow-run-info">
            <div className="workflow-run-info-item">
              <label>{t('status')}</label>
              <span style={{ color: getStatusColor(selectedRun.status) }}>
                {getStatusText(selectedRun.status)}
              </span>
            </div>
            <div className="workflow-run-info-item">
              <label>{t('runProgress')}</label>
              <span className="workflow-run-progress">
                <svg
                  className="workflow-run-progress-ring"
                  viewBox="0 0 36 36"
                  aria-hidden="true"
                >
                  <circle
                    className="workflow-run-progress-track"
                    cx="18"
                    cy="18"
                    r="15.5"
                    fill="none"
                    strokeWidth="3"
                  />
                  <circle
                    className={`workflow-run-progress-arc${progress === 100 ? ' complete' : ''}`}
                    cx="18"
                    cy="18"
                    r="15.5"
                    fill="none"
                    strokeWidth="3"
                    strokeDasharray={`${(progress / 100) * 97.4} 97.4`}
                    strokeLinecap="round"
                    transform="rotate(-90 18 18)"
                  />
                </svg>
                <span className="workflow-run-progress-value">{progress}%</span>
              </span>
            </div>
            <div className="workflow-run-info-item">
              <label>{t('runStartedAt')}</label>
              <span>{selectedRun.startedAt ? new Date(selectedRun.startedAt).toLocaleString() : '-'}</span>
            </div>
            <div className="workflow-run-info-item">
              <label>{t('runCompletedAt')}</label>
              <span>{selectedRun.completedAt ? new Date(selectedRun.completedAt).toLocaleString() : '-'}</span>
            </div>
          </div>

          {selectedRun.error && (
            <div className="workflow-error" role="alert">{selectedRun.error}</div>
          )}

          {selectedGates.length > 0 && (
            <div className="workflow-gates">
              <h4>{t('pendingApprovals')}</h4>
              {selectedGates.map((gate) => (
                <div key={`${gate.runId}-${gate.stepId}`} className="workflow-gate-card">
                  <p className="workflow-gate-question">{gate.question}</p>
                  <p className="workflow-gate-step">{gate.stepId}</p>
                  <div className="workflow-gate-actions">
                    {gate.options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        disabled={resolvingGate !== null}
                        className={`workflow-btn small ${(gate.pass?.includes(option) || (!gate.pass && (option === 'approved' || option === gate.options[0]))) ? 'primary' : ''}`}
                        onClick={() => void handleResolveGate(gate, option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="workflow-run-graph-toolbar" style={{ marginTop: 8 }}>
            <div className="workflow-run-graph-legend" role="group" aria-label={t('runViewGraph')}>
              <button
                type="button"
                className={`workflow-btn small${viewMode === 'graph' ? ' primary' : ''}`}
                aria-pressed={viewMode === 'graph'}
                onClick={() => setViewMode('graph')}
              >
                {t('runViewGraph')}
              </button>
              <button
                type="button"
                className={`workflow-btn small${viewMode === 'list' ? ' primary' : ''}`}
                aria-pressed={viewMode === 'list'}
                onClick={() => setViewMode('list')}
              >
                {t('runViewList')}
              </button>
            </div>
          </div>

          {viewMode === 'graph' ? (
            <WorkflowRunGraph
              api={api}
              t={t}
              run={selectedRun}
              gates={selectedGates}
              transcript={transcript}
              onResolveGate={(gate, decision) => void handleResolveGate(gate, decision)}
              resolvingGate={resolvingGate}
            />
          ) : (
            <>
              <h4>{t('runSteps')}</h4>
              <div className="workflow-run-steps">
                {selectedRun.steps?.map((step) => (
                  <div key={step.id} className="workflow-run-step">
                    <div className="workflow-run-step-header">
                      <span className="workflow-run-step-id">{step.id}</span>
                      <span
                        className="workflow-run-step-status"
                        style={{ backgroundColor: getStatusColor(step.status) }}
                      >
                        {getStatusText(step.status)}
                      </span>
                    </div>
                    {step.output && (
                      <pre className="workflow-run-step-output">{step.output}</pre>
                    )}
                    {step.error && (
                      <div className="workflow-run-step-error">{step.error}</div>
                    )}
                  </div>
                ))}
              </div>

              <h4>{t('runTranscript')}</h4>
              {transcript.length === 0 ? (
                <p className="workflow-canvas-inspector-empty">{t('runTranscriptEmpty')}</p>
              ) : (
                <div className="workflow-run-transcript">
                  {transcript.map((event, index) => (
                    <div key={`${event.ts}-${event.type}-${index}`} className="workflow-run-transcript-event">
                      <div className="workflow-run-transcript-meta">
                        <code>{event.type}</code>
                        <span>{event.ts ? new Date(event.ts).toLocaleString() : ''}</span>
                        {event.stepId ? <span>{event.stepId}</span> : null}
                      </div>
                      {event.data && (
                        <pre className="workflow-run-step-output">
                          {JSON.stringify(event.data, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {exportPreview && (
            <>
              <h4>{t('runExport')}</h4>
              <pre className="workflow-run-step-output">{exportPreview}</pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}
