import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import type { WorkflowTranscriptEventView } from './desktop-workflow-api.js'
import {
  buildNarrative,
  lastEntryIndexForStep,
  STEP_TYPE_COLORS,
  type NarrativeEntry,
} from './workflow-run-narrative.js'
import type { RunStepView } from './desktop-workflow-api.js'

interface WorkflowRunNarrativeProps {
  t: (key: WorkflowLocaleKey) => string
  steps: readonly RunStepView[]
  transcript: readonly WorkflowTranscriptEventView[]
  /** stepId → step-type (for the accent-colored chip). */
  stepTypeById: Readonly<Record<string, string>>
  selectedStepId: string | null
  onSelectStep: (stepId: string | null) => void
  /** Compact summary slot rendered above the list (e.g. selected node stats). */
  summary?: React.ReactNode
  title?: string
}

/**
 * Scrolling execution explanation beside the run graph.
 * One human-readable line per transcript event, auto-scrolling (stick to
 * bottom) with bidirectional linking to the graph's selected node.
 */
export function WorkflowRunNarrative({
  t,
  steps,
  transcript,
  stepTypeById,
  selectedStepId,
  onSelectStep,
  summary,
  title,
}: WorkflowRunNarrativeProps) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const [followTail, setFollowTail] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const entries = useMemo(
    () => buildNarrative(steps, transcript, t),
    [steps, transcript, t],
  )

  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24
    setFollowTail(atBottom)
  }, [])

  // Stick to the tail when new events arrive and the user has not scrolled up.
  useEffect(() => {
    const el = listRef.current
    if (!el || !followTail) return
    el.scrollTop = el.scrollHeight
  }, [entries.length, followTail])

  // Node-click linkage: scroll the latest entry for the selected step into view.
  const lastSelectedStep = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedStepId || selectedStepId === lastSelectedStep.current) return
    lastSelectedStep.current = selectedStepId
    const index = lastEntryIndexForStep(entries, selectedStepId)
    const el = listRef.current
    if (index < 0 || !el) return
    const node = el.querySelector<HTMLElement>(`[data-entry-index="${index}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [selectedStepId, entries])

  // Toggling a raw payload should not flip the follow-tail flag.
  const toggleRaw = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const handleEntryClick = useCallback((entry: NarrativeEntry) => {
    onSelectStep(entry.stepId && entry.stepId !== selectedStepId ? entry.stepId : null)
  }, [onSelectStep, selectedStepId])

  return (
    <aside className="workflow-run-narrative" aria-label={t('runNarrative')}>
      <div className="workflow-run-narrative-header">
        <span className="workflow-run-narrative-title">{title ?? t('runNarrative')}</span>
        <button
          type="button"
          className={`workflow-btn small${followTail ? ' primary' : ''}`}
          aria-pressed={followTail}
          onClick={() => {
            setFollowTail(true)
            const el = listRef.current
            if (el) el.scrollTop = el.scrollHeight
          }}
        >
          {t('runFollowTail')}
        </button>
      </div>

      {summary}

      <div
        className="workflow-run-narrative-list"
        ref={listRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {entries.length === 0 ? (
          <p className="workflow-run-narrative-empty">{t('runNarrativeEmpty')}</p>
        ) : (
          entries.map((entry, index) => {
            const chipColor = entry.stepId
              ? (STEP_TYPE_COLORS[stepTypeById[entry.stepId] ?? ''] ?? '#64748b')
              : undefined
            const isOpen = expanded[entry.id] === true
            return (
              <button
                key={entry.id}
                type="button"
                data-entry-index={index}
                className={`workflow-narrative-entry tone-${entry.tone}${
                  entry.stepId && entry.stepId === selectedStepId ? ' selected' : ''
                }`}
                onClick={() => handleEntryClick(entry)}
              >
                <span className="workflow-narrative-entry-bar" aria-hidden="true" />
                <span className="workflow-narrative-entry-body">
                  <span className="workflow-narrative-entry-meta">
                    <span>{entry.ts ? new Date(entry.ts).toLocaleTimeString() : ''}</span>
                    {entry.stepId && (
                      <span
                        className="workflow-narrative-entry-chip"
                        style={{ backgroundColor: chipColor }}
                      >
                        {entry.stepId}
                      </span>
                    )}
                    {entry.attempt !== undefined && entry.attempt > 1 && (
                      <span>×{entry.attempt}</span>
                    )}
                  </span>
                  <span className="workflow-narrative-entry-title">{entry.title}</span>
                  {entry.raw && (
                    <>
                      <span
                        className="workflow-narrative-entry-raw-toggle"
                        role="presentation"
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleRaw(entry.id)
                        }}
                      >
                        {isOpen ? '▲' : '▼'} {t('runNarrativeRaw')}
                      </span>
                      {isOpen && (
                        <pre className="workflow-narrative-entry-raw">{entry.raw}</pre>
                      )}
                    </>
                  )}
                </span>
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}
