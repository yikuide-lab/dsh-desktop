import { useCallback, useEffect, useState } from 'react'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import type {
  DesktopWorkflowApi,
  WorkflowStatsDetailView,
  WorkflowStatsSummaryView,
} from './desktop-workflow-api.js'

interface WorkflowStatsProps {
  api: DesktopWorkflowApi
  t: (key: WorkflowLocaleKey) => string
  /** Prefill selection when opening from a workflow card. */
  focusName?: string | null
  onFocusConsumed?: () => void
  onOpenRun?: (runId: string) => void
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const sec = ms / 1000
  if (sec < 60) return `${sec.toFixed(1)}s`
  const min = Math.floor(sec / 60)
  const rem = Math.round(sec % 60)
  return `${min}m ${rem}s`
}

function formatRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '0%'
  return `${Math.round(rate * 1000) / 10}%`
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  return new Date(ms).toLocaleString()
}

/** Per-workflow usage summaries and detail (from retained run history). */
export function WorkflowStats({
  api,
  t,
  focusName,
  onFocusConsumed,
  onOpenRun,
}: WorkflowStatsProps) {
  const [summaries, setSummaries] = useState<WorkflowStatsSummaryView[]>([])
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [detail, setDetail] = useState<WorkflowStatsDetailView | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSummaries = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const list = await api.getWorkflowStats()
      setSummaries(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setIsLoading(false)
    }
  }, [api, t])

  useEffect(() => {
    void loadSummaries()
  }, [loadSummaries])

  useEffect(() => {
    if (!focusName) return
    setSelectedName(focusName)
    onFocusConsumed?.()
  }, [focusName, onFocusConsumed])

  useEffect(() => {
    if (!selectedName) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    void api.getWorkflowStatsDetail(selectedName)
      .then((next) => {
        if (!cancelled) setDetail(next)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t('error'))
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [api, selectedName, t])

  const maxDayTotal = detail?.byDay.reduce((max, day) => Math.max(max, day.total), 0) ?? 0

  if (isLoading && summaries.length === 0) {
    return <div className="workflow-loading">{t('loading')}</div>
  }

  return (
    <div className="workflow-stats">
      <p className="workflow-stats-note">{t('statsRetainedNote')}</p>
      {error && (
        <div className="workflow-error">
          <p>{error}</p>
          <button type="button" className="workflow-btn" onClick={() => void loadSummaries()}>
            {t('retry')}
          </button>
        </div>
      )}

      <div className="workflow-stats-layout">
        <div className="workflow-stats-list">
          <div className="workflow-stats-list-header">
            <h3>{t('statsTab')}</h3>
            <button type="button" className="workflow-btn small" onClick={() => void loadSummaries()}>
              {t('refresh')}
            </button>
          </div>
          {summaries.length === 0 ? (
            <div className="workflow-empty">
              <h3>{t('statsEmpty')}</h3>
            </div>
          ) : (
            summaries.map((summary) => (
              <button
                type="button"
                key={summary.workflowName}
                className={`workflow-stats-card ${selectedName === summary.workflowName ? 'selected' : ''}`}
                onClick={() => setSelectedName(summary.workflowName)}
              >
                <div className="workflow-stats-card-title">
                  {summary.title || summary.workflowName}
                </div>
                <div className="workflow-stats-card-name">{summary.workflowName}</div>
                <div className="workflow-stats-card-meta">
                  <span>{summary.totalRuns} {t('statsRuns')}</span>
                  <span>{t('statsSuccessRate')}: {formatRate(summary.successRate)}</span>
                  <span>{t('statsAvgDuration')}: {formatDuration(summary.avgDurationMs)}</span>
                  <span>{t('statsLastRun')}: {formatWhen(summary.lastRunAt)}</span>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="workflow-stats-detail">
          {!selectedName && (
            <div className="workflow-empty">
              <p>{t('statsSelectHint')}</p>
            </div>
          )}
          {selectedName && detailLoading && !detail && (
            <div className="workflow-loading">{t('loading')}</div>
          )}
          {selectedName && detail && (
            <>
              <div className="workflow-stats-detail-header">
                <h3>{detail.title || detail.workflowName}</h3>
                <span className="workflow-card-name">{detail.workflowName}</span>
              </div>
              <div className="workflow-stats-summary-bar">
                <div><strong>{detail.totalRuns}</strong><span>{t('statsRuns')}</span></div>
                <div><strong>{detail.completed}</strong><span>{t('completed')}</span></div>
                <div><strong>{detail.failed}</strong><span>{t('failed')}</span></div>
                <div><strong>{detail.aborted}</strong><span>{t('aborted')}</span></div>
                <div><strong>{detail.running}</strong><span>{t('running')}</span></div>
                <div><strong>{formatRate(detail.successRate)}</strong><span>{t('statsSuccessRate')}</span></div>
                <div><strong>{formatDuration(detail.avgDurationMs)}</strong><span>{t('statsAvgDuration')}</span></div>
              </div>

              <section className="workflow-stats-section">
                <h4>{t('statsByDay')}</h4>
                {detail.byDay.length === 0 ? (
                  <p className="workflow-stats-muted">{t('statsNoDayBuckets')}</p>
                ) : (
                  <div className="workflow-stats-byday">
                    {detail.byDay.map((day) => (
                      <div key={day.date} className="workflow-stats-day-row">
                        <span className="workflow-stats-day-date">{day.date}</span>
                        <div className="workflow-stats-day-bar-track" aria-hidden="true">
                          <div
                            className="workflow-stats-day-bar"
                            style={{
                              width: maxDayTotal > 0
                                ? `${Math.max(4, (day.total / maxDayTotal) * 100)}%`
                                : '0%',
                            }}
                          />
                        </div>
                        <span className="workflow-stats-day-counts">
                          {day.total} · {t('completed')} {day.completed} · {t('failed')} {day.failed}
                          {day.avgDurationMs != null ? ` · ${formatDuration(day.avgDurationMs)}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="workflow-stats-section">
                <h4>{t('statsRecentRuns')}</h4>
                {detail.recentRuns.length === 0 ? (
                  <p className="workflow-stats-muted">{t('noRuns')}</p>
                ) : (
                  <ul className="workflow-stats-recent">
                    {detail.recentRuns.map((run) => (
                      <li key={run.id}>
                        <button
                          type="button"
                          className="workflow-stats-recent-item"
                          onClick={() => onOpenRun?.(run.id)}
                        >
                          <span className="workflow-stats-recent-id">{run.id.slice(0, 8)}</span>
                          <span>{run.status}</span>
                          <span>{formatWhen(run.startedAt)}</span>
                          <span>{formatDuration(run.durationMs ?? null)}</span>
                        </button>
                        {run.error && (
                          <div className="workflow-stats-recent-error">{run.error}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
