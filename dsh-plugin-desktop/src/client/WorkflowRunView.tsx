import { useState, useEffect, useCallback, useRef } from 'react'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import type { WorkflowRun, PendingGateView, WorkflowViewStore } from './workflow-store.js'
import type { DesktopWorkflowApi, WorkflowTranscriptEventView } from './desktop-workflow-api.js'
import { WorkflowRunGraph } from './WorkflowRunGraph.js'
import { WorkflowAiDesignPanel } from './WorkflowAiDesignPanel.js'
import { RunResizeHandle } from './RunResizeHandle.js'
import {
  buildDiagnosisPrompt,
  buildRunDiagnosticMarkdown,
  withWorkflowIdentity,
} from './workflow-run-diagnostic.js'
import {
  clampListWidth,
  RUN_LIST_DEFAULT_WIDTH,
  RUN_LIST_MAX_WIDTH,
  RUN_LIST_MIN_WIDTH,
  RUN_LIST_WIDTH_STORAGE_KEY,
} from './workflow-run-layout.js'

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
  const runsRootRef = useRef<HTMLDivElement | null>(null)
  const [listWidth, setListWidth] = useState<number>(RUN_LIST_DEFAULT_WIDTH)
  const listWidthRef = useRef<number>(RUN_LIST_DEFAULT_WIDTH)
  const listResizeStart = useRef<number>(RUN_LIST_DEFAULT_WIDTH)
  const [listResizing, setListResizing] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [diagnosticMd, setDiagnosticMd] = useState('')
  const [diagnosisPrompt, setDiagnosisPrompt] = useState('')
  const [copied, setCopied] = useState(false)
  const [stagedYaml, setStagedYaml] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

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

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RUN_LIST_WIDTH_STORAGE_KEY)
      if (!raw) return
      const parsed = Number(raw)
      if (!Number.isFinite(parsed)) return
      const clamped = Math.min(RUN_LIST_MAX_WIDTH, Math.max(RUN_LIST_MIN_WIDTH, Math.round(parsed)))
      listWidthRef.current = clamped
      setListWidth(clamped)
    } catch {
      // storage unavailable — keep the default
    }
  }, [])

  const setListWidthPersist = (width: number) => {
    listWidthRef.current = width
    setListWidth(width)
  }

  const persistListWidth = () => {
    try {
      window.localStorage.setItem(RUN_LIST_WIDTH_STORAGE_KEY, String(listWidthRef.current))
    } catch {
      // storage unavailable
    }
  }

  const handleListResizeStart = () => {
    listResizeStart.current = listWidthRef.current
    setListResizing(true)
  }

  const handleListResize = (delta: number) => {
    const container = runsRootRef.current?.clientWidth ?? 0
    setListWidthPersist(clampListWidth(listResizeStart.current + delta, container || window.innerWidth))
  }

  const handleListResizeEnd = () => {
    setListResizing(false)
    persistListWidth()
  }

  const handleListNudge = (deltaPx: number) => {
    const container = runsRootRef.current?.clientWidth ?? 0
    setListWidthPersist(clampListWidth(listWidthRef.current + deltaPx, container || window.innerWidth))
    persistListWidth()
  }

  const buildDiagnostic = async (run: WorkflowRun) => {
    const exported = await api.exportRun(run.id)
    const workflow = await api.getWorkflow(run.workflowName).catch(() => null)
    return buildRunDiagnosticMarkdown({
      run: exported.run,
      transcript: exported.transcript,
      workflow,
      t,
    })
  }

  const handleExportDiagnostic = async (run: WorkflowRun) => {
    setBusyAction(true)
    setError(null)
    setNotice(null)
    try {
      const md = await buildDiagnostic(run)
      const blob = new Blob([md], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${run.workflowName}-${run.id}-diagnostic.md`
      a.click()
      URL.revokeObjectURL(url)
      setNotice(t('runDiagnosed'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setBusyAction(false)
    }
  }

  const handleOpenAiDiagnose = async (run: WorkflowRun) => {
    setBusyAction(true)
    setError(null)
    setNotice(null)
    try {
      const md = await buildDiagnostic(run)
      setDiagnosticMd(md)
      setDiagnosisPrompt(buildDiagnosisPrompt({
        markdown: md,
        workflowName: run.workflowName,
        runId: run.id,
        t,
      }))
      setStagedYaml(null)
      setCopied(false)
      setAiOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setBusyAction(false)
    }
  }

  const handleCopyDiagnostic = async () => {
    try {
      await navigator.clipboard.writeText(diagnosticMd)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const handleApplyDiagnosis = async (yaml: string) => {
    if (!selectedRun) return
    setApplying(true)
    setError(null)
    try {
      const workflow = await api.getWorkflow(selectedRun.workflowName).catch(() => null)
      const pinned = withWorkflowIdentity(yaml, {
        ...(workflow?.uid ? { uid: workflow.uid } : {}),
        name: selectedRun.workflowName,
      })
      await api.saveWorkflow(pinned)
      setStagedYaml(null)
      setNotice(t('aiDiagnoseApplied'))
      setAiOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setApplying(false)
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
    <div
      className="workflow-runs"
      ref={runsRootRef}
      data-resizing={listResizing ? 'list' : undefined}
    >
      {error && <div className="workflow-error" role="alert">{error}</div>}
      {notice && <div className="workflow-notice" role="status">{notice}</div>}
      <div className="workflow-runs-list" style={{ width: listWidth }}>
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

      <RunResizeHandle
        label={t('resizeRunList')}
        value={listWidth}
        onStart={handleListResizeStart}
        onDrag={handleListResize}
        onEnd={handleListResizeEnd}
        onNudge={handleListNudge}
      />

      {selectedRun && (
        <div className="workflow-run-detail">
          <div className="workflow-list-header">
            <h3>{t('view')}: {selectedRun.workflowName}</h3>
            <div className="workflow-settings-provider-actions">
              <button
                type="button"
                className="workflow-btn small"
                disabled={busyAction}
                onClick={() => void handleExportDiagnostic(selectedRun)}
              >
                {t('runDiagnostic')}
              </button>
              <button
                type="button"
                className="workflow-btn small primary"
                disabled={busyAction}
                onClick={() => void handleOpenAiDiagnose(selectedRun)}
              >
                {t('runAiDiagnose')}
              </button>
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

      {aiOpen && selectedRun && (
        <div
          className="workflow-unsaved-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={t('aiDiagnoseTitle')}
        >
          <div className="workflow-unsaved-dialog-card workflow-diagnose-card">
            <h3>{t('aiDiagnoseTitle')}</h3>
            <p>{t('aiDiagnoseHint')}</p>
            <details className="workflow-diagnose-context" open>
              <summary>{t('aiDiagnosePreview')}</summary>
              <div className="workflow-diagnose-context-toolbar">
                <button
                  type="button"
                  className="workflow-btn small"
                  onClick={() => void handleCopyDiagnostic()}
                >
                  {copied ? t('aiDiagnoseCopied') : t('aiDiagnoseCopy')}
                </button>
              </div>
              <pre className="workflow-diagnose-context-pre">{diagnosticMd}</pre>
            </details>
            <WorkflowAiDesignPanel
              api={api}
              getCurrentYaml={async () => api.exportWorkflowYaml(selectedRun.workflowName)}
              onApply={(yaml) => void handleApplyDiagnosis(yaml)}
              onRestore={(yaml) => setStagedYaml(yaml)}
              applyLabel={t('aiDiagnoseApply')}
              applyInvalidConfirmLabel={t('aiDiagnoseApplyInvalidConfirm')}
              initialPrompt={diagnosisPrompt}
              t={t}
              open
              onOpenChange={(next) => { if (!next) setAiOpen(false) }}
            />
            <div className="workflow-unsaved-dialog-actions">
              <button
                type="button"
                className="workflow-btn primary"
                disabled={applying || stagedYaml === null}
                onClick={() => { if (stagedYaml) void handleApplyDiagnosis(stagedYaml) }}
              >
                {t('aiDiagnoseApply')}
              </button>
              <button
                type="button"
                className="workflow-btn"
                disabled={applying}
                onClick={() => setAiOpen(false)}
              >
                {t('close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
