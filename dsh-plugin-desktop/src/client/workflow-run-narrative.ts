/**
 * Pure helpers that turn a run's transcript + step state into a scrolling
 * "execution explanation" narrative (one human-readable line per event).
 */

import type {
  RunDispatchView,
  RunStepView,
  WorkflowTranscriptEventView,
} from './desktop-workflow-api.js'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import { formatDuration } from './workflow-run-graph.js'

export type NarrativeKind =
  | 'run-start'
  | 'run-done'
  | 'run-fail'
  | 'run-abort'
  | 'run-orphan'
  | 'step-start'
  | 'step-done'
  | 'step-fail'
  | 'gate'
  | 'llm'
  | 'task'
  | 'script'
  | 'error'
  | 'muted'

export type NarrativeTone = 'info' | 'success' | 'error' | 'warn' | 'muted'

export interface NarrativeEntry {
  /** Stable key for React lists (ts + type + stepId + index). */
  id: string
  ts: string
  kind: NarrativeKind
  tone: NarrativeTone
  stepId?: string
  dispatchId?: string
  /** Human-readable one-liner (already localized). */
  title: string
  /** Collapsible raw payload (output / error / prompt excerpt). */
  raw?: string
  /** Attempt number for retry-aware wording. */
  attempt?: number
  durationMs?: number
}

/** Fill `{placeholder}` slots in a localized template. */
export function fill(template: string, vars: Record<string, string | number>): string {
  let out = template
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{${key}}`).join(String(value))
  }
  return out
}

/** Map a transcript event type onto a narrative kind. */
export function narrativeKind(type: string): NarrativeKind {
  switch (type) {
    case 'run.start': return 'run-start'
    case 'run.complete': return 'run-done'
    case 'run.fail': return 'run-fail'
    case 'run.abort': return 'run-abort'
    case 'run.orphan': return 'run-orphan'
    case 'dispatch.submit': return 'step-start'
    case 'dispatch.settle': return 'step-done' // refined with success/error in buildNarrative
    case 'gate.resolve': return 'gate'
    case 'llm.request':
    case 'llm.response': return 'llm'
    case 'task.request':
    case 'task.response': return 'task'
    case 'script.result': return 'script'
    case 'error': return 'error'
    default: return 'muted'
  }
}

const TONE_BY_KIND: Record<NarrativeKind, NarrativeTone> = {
  'run-start': 'info',
  'run-done': 'success',
  'run-fail': 'error',
  'run-abort': 'warn',
  'run-orphan': 'warn',
  'step-start': 'info',
  'step-done': 'success',
  'step-fail': 'error',
  gate: 'warn',
  llm: 'muted',
  task: 'muted',
  script: 'muted',
  error: 'error',
  muted: 'muted',
}

export function narrativeTone(kind: NarrativeKind): NarrativeTone {
  return TONE_BY_KIND[kind] ?? 'muted'
}

/** Compact raw payload for the collapsible detail (stringified, truncated). */
export function entryDetailRaw(data: Record<string, unknown> | undefined): string | undefined {
  if (!data) return undefined
  const parts: string[] = []
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue
    if (key === 'params' || key === 'cwd' || key === 'live') continue
    let rendered: string
    if (typeof value === 'string') rendered = value
    else {
      try { rendered = JSON.stringify(value) } catch { rendered = String(value) }
    }
    if (rendered.length > 600) rendered = `${rendered.slice(0, 600)}…`
    parts.push(`${key}: ${rendered}`)
  }
  return parts.length > 0 ? parts.join('\n') : undefined
}

function pickString(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = data?.[key]
  return typeof value === 'string' ? value : undefined
}

function lookupDispatch(
  steps: readonly RunStepView[],
  stepId: string | undefined,
  dispatchId: string | undefined,
): RunDispatchView | undefined {
  if (!dispatchId) return undefined
  const step = stepId
    ? steps.find((entry) => entry.id === stepId)
    : steps.find((entry) => entry.dispatches?.some((d) => d.id === dispatchId))
  return step?.dispatches?.find((dispatch) => dispatch.id === dispatchId)
}

/** Localized one-liner for a transcript event. */
export function formatNarrativeTitle(
  event: WorkflowTranscriptEventView,
  t: (key: WorkflowLocaleKey) => string,
  options: { attempt?: number; durationMs?: number } = {},
): { kind: NarrativeKind; tone: NarrativeTone; title: string } {
  const kind = narrativeKind(event.type)
  const data = event.data
  const step = event.stepId ?? ''

  switch (event.type) {
    case 'run.start': {
      const name = pickString(data, 'workflowName') ?? ''
      return {
        kind,
        tone: narrativeTone(kind),
        title: name ? fill(t('narrativeRunStart'), { workflow: name }) : t('narrativeRunStartPlain'),
      }
    }
    case 'run.complete':
      return { kind, tone: narrativeTone(kind), title: t('narrativeRunDone') }
    case 'run.fail': {
      const err = pickString(data, 'error') ?? ''
      return {
        kind,
        tone: narrativeTone(kind),
        title: err ? fill(t('narrativeRunFail'), { err }) : t('narrativeRunFailPlain'),
      }
    }
    case 'run.abort': {
      const reason = pickString(data, 'reason') ?? ''
      return {
        kind,
        tone: narrativeTone(kind),
        title: reason ? fill(t('narrativeRunAbort'), { reason }) : t('narrativeRunAbortPlain'),
      }
    }
    case 'run.orphan':
      return { kind, tone: narrativeTone(kind), title: t('narrativeRunOrphan') }

    case 'dispatch.submit': {
      const attempt = options.attempt
      return {
        kind: 'step-start',
        tone: narrativeTone('step-start'),
        title: attempt && attempt > 1
          ? fill(t('narrativeStepRetry'), { step, n: attempt })
          : fill(t('narrativeStepStart'), { step }),
      }
    }

    case 'dispatch.settle': {
      const success = data?.success === true
      const err = pickString(data, 'error') ?? ''
      const dur = formatDuration(options.durationMs)
      const attempt = options.attempt
      if (success) {
        return {
          kind: 'step-done',
          tone: narrativeTone('step-done'),
          title: dur
            ? fill(t('narrativeStepDone'), { step, dur })
            : fill(t('narrativeStepDonePlain'), { step }),
        }
      }
      if (attempt && attempt > 1) {
        return {
          kind: 'step-fail',
          tone: narrativeTone('step-fail'),
          title: err
            ? fill(t('narrativeStepRetryFail'), { step, n: attempt, err })
            : fill(t('narrativeStepRetryFailPlain'), { step, n: attempt }),
        }
      }
      return {
        kind: 'step-fail',
        tone: narrativeTone('step-fail'),
        title: err
          ? fill(t('narrativeStepFail'), { step, err })
          : fill(t('narrativeStepFailPlain'), { step }),
      }
    }

    case 'gate.resolve': {
      const decision = pickString(data, 'decision') ?? ''
      const who = pickString(data, 'resolvedBy') ?? ''
      return {
        kind,
        tone: narrativeTone(kind),
        title: fill(t('narrativeGate'), { step, who, decision }),
      }
    }

    case 'llm.request':
    case 'llm.response': {
      const model = pickString(data, 'model') ?? ''
      const output = pickString(data, 'output')
      const ok = data?.ok === true
      const err = pickString(data, 'error') ?? ''
      if (event.type === 'llm.request') {
        return {
          kind,
          tone: narrativeTone(kind),
          title: model ? fill(t('narrativeLlmReq'), { step, model }) : fill(t('narrativeLlmReqPlain'), { step }),
        }
      }
      if (!ok) {
        return {
          kind: 'step-fail',
          tone: narrativeTone('step-fail'),
          title: err ? fill(t('narrativeLlmFail'), { step, err }) : fill(t('narrativeLlmFailPlain'), { step }),
        }
      }
      const n = typeof output === 'string' ? output.length : 0
      return {
        kind,
        tone: narrativeTone(kind),
        title: fill(t('narrativeLlmResp'), { step, n }),
      }
    }

    case 'task.request':
    case 'task.response': {
      const role = pickString(data, 'role') ?? ''
      const ok = data?.ok === true
      const err = pickString(data, 'error') ?? ''
      if (event.type === 'task.request') {
        return {
          kind,
          tone: narrativeTone(kind),
          title: role ? fill(t('narrativeTaskReq'), { step, role }) : fill(t('narrativeTaskReqPlain'), { step }),
        }
      }
      if (!ok) {
        return {
          kind: 'step-fail',
          tone: narrativeTone('step-fail'),
          title: err ? fill(t('narrativeTaskFail'), { step, err }) : fill(t('narrativeTaskFailPlain'), { step }),
        }
      }
      return {
        kind,
        tone: narrativeTone(kind),
        title: fill(t('narrativeTaskResp'), { step }),
      }
    }

    case 'script.result': {
      const ok = data?.ok === true
      return {
        kind,
        tone: ok ? 'success' : 'error',
        title: fill(t('narrativeScript'), { step }),
      }
    }

    case 'error': {
      const err = pickString(data, 'error') ?? pickString(data, 'message') ?? ''
      return {
        kind,
        tone: narrativeTone(kind),
        title: err ? fill(t('narrativeError'), { step, err }) : t('narrativeErrorPlain'),
      }
    }

    default:
      return {
        kind: 'muted',
        tone: 'muted',
        title: fill(t('narrativeUnknown'), { type: event.type }),
      }
  }
}

/**
 * Build the scrolling narrative for a run.
 * One entry per transcript event, enriched with attempt/duration from the
 * run's dispatch history. Sorted by timestamp (stable for equal ts).
 */
export function buildNarrative(
  steps: readonly RunStepView[],
  transcript: readonly WorkflowTranscriptEventView[],
  t: (key: WorkflowLocaleKey) => string,
): NarrativeEntry[] {
  const submitCount = new Map<string, number>()

  const entries: NarrativeEntry[] = transcript.map((event, index) => {
    const dispatch = lookupDispatch(steps, event.stepId, event.dispatchId)
    let attempt = dispatch?.attempt
    if (attempt === undefined && event.type === 'dispatch.submit' && event.stepId) {
      const count = (submitCount.get(event.stepId) ?? 0) + 1
      submitCount.set(event.stepId, count)
      attempt = count
    }
    const durationMs = dispatch
      ? (dispatch.completedAt && dispatch.startedAt
        ? safeDuration(dispatch.startedAt, dispatch.completedAt)
        : undefined)
      : undefined

    const formatted = formatNarrativeTitle(event, t, {
      ...(attempt !== undefined ? { attempt } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    })

    const entry: NarrativeEntry = {
      id: `${event.ts}|${event.type}|${event.stepId ?? ''}|${index}`,
      ts: event.ts,
      kind: formatted.kind,
      tone: formatted.tone,
      title: formatted.title,
    }
    if (event.stepId) entry.stepId = event.stepId
    if (event.dispatchId) entry.dispatchId = event.dispatchId
    if (attempt !== undefined) entry.attempt = attempt
    if (durationMs !== undefined) entry.durationMs = durationMs
    const raw = entryDetailRaw(event.data)
    if (raw) entry.raw = raw
    return entry
  })

  // Stable chronological order; transcript is append-only but be defensive.
  entries.sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
  return entries
}

function safeDuration(startedAt: string, completedAt: string): number | undefined {
  const start = Date.parse(startedAt)
  const end = Date.parse(completedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined
  return end - start
}

/**
 * Step-type accent colors (mirrors `.workflow-flow-node.type-*` borders) used
 * to tint the stepId chip in narrative entries.
 */
export const STEP_TYPE_COLORS: Record<string, string> = {
  script: '#8b5cf6',
  task: '#3b82f6',
  llm: '#10b981',
  approval: '#f59e0b',
  sub_workflow: '#ec4899',
}

/** Latest entry index for a step — where the narrative should scroll to. */
export function lastEntryIndexForStep(
  entries: readonly NarrativeEntry[],
  stepId: string | null,
): number {
  if (!stepId) return -1
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i]?.stepId === stepId) return i
  }
  return -1
}

export interface ScrollRevealInput {
  /** Target top edge relative to the scrollport's top edge (may be negative). */
  targetTopInView: number
  targetHeight: number
  viewportHeight: number
  currentScrollTop: number
  scrollHeight: number
  /** Still counts as visible within this many px. Default 8. */
  slack?: number
}

/**
 * scrollTop that reveals one entry inside a single scrollport: unchanged when
 * the entry is already visible, otherwise centered and clamped to the
 * scrollable range. Callers must assign the result to the innermost list's
 * `scrollTop` — `element.scrollIntoView` walks every scrollable ancestor and
 * would drag `.workflow-run-detail` (and the run graph above it) out of view.
 */
export function scrollTopToReveal(input: ScrollRevealInput): number {
  const slack = input.slack ?? 8
  const max = Math.max(0, input.scrollHeight - input.viewportHeight)
  const clamp = (value: number): number => Math.min(max, Math.max(0, Math.round(value)))
  const bottomInView = input.targetTopInView + input.targetHeight
  const visible =
    input.targetTopInView >= -slack && bottomInView <= input.viewportHeight + slack
  if (visible) return clamp(input.currentScrollTop)
  const centered =
    input.currentScrollTop +
    input.targetTopInView -
    (input.viewportHeight - input.targetHeight) / 2
  return clamp(centered)
}
