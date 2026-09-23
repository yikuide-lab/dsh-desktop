import type {
  RunDispatchView,
  RunStepView,
  WorkflowRunView,
  WorkflowTranscriptEventView,
  WorkflowView,
} from './desktop-workflow-api.js'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import { formatDuration } from './workflow-run-graph.js'
import { buildNarrative, fill, type NarrativeEntry } from './workflow-run-narrative.js'

export type DiagnosticTranslate = (key: WorkflowLocaleKey) => string

export interface RunDiagnosticOptions {
  /** Truncate each step's output/error prose to this many chars (default 2000). */
  maxOutputCharsPerStep?: number
  /** Keep full step outputs (no truncation). Default false. */
  includeFullOutputs?: boolean
  /** Timestamp stamped in the header (default: now, ISO). */
  generatedAt?: string
}

const DEFAULT_MAX_OUTPUT_CHARS = 2000

export function truncateText(text: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, maxChars)}…`
}

function statusText(status: string, t: DiagnosticTranslate): string {
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

function cell(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === '') return '—'
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function codeBlock(text: string): string {
  const safe = text.replace(/```/g, "'''")
  return ['```', safe, '```'].join('\n')
}

function paramLine(params: Record<string, unknown> | undefined): string {
  if (!params) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    const rendered = typeof value === 'string' ? value : JSON.stringify(value)
    parts.push(`${key}=${truncateText(rendered, 240)}`)
  }
  return parts.join('\n')
}

function stepDuration(step: RunStepView): number | undefined {
  if (typeof step.durationMs === 'number' && Number.isFinite(step.durationMs)) return step.durationMs
  return undefined
}

function dispatchDuration(dispatch: RunDispatchView): number | undefined {
  if (!dispatch.startedAt || !dispatch.completedAt) return undefined
  const start = Date.parse(dispatch.startedAt)
  const end = Date.parse(dispatch.completedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined
  return end - start
}

/** Steps that need a closer look: failed/aborted, retried, compensated, or errored. */
export function interestingSteps(steps: readonly RunStepView[]): RunStepView[] {
  return steps.filter((step) => {
    if (step.status === 'failed' || step.status === 'aborted') return true
    if (typeof step.attempt === 'number' && step.attempt > 1) return true
    if (step.error) return true
    return (step.dispatches ?? []).some(
      (dispatch) => dispatch.phase === 'compensate' || Boolean(dispatch.error),
    )
  })
}

/** Root-cause leads derived from the run shape (heuristic, deterministic). */
export function buildAdviceHints(steps: readonly RunStepView[], t: DiagnosticTranslate): string[] {
  const hints: string[] = []
  const firstFailed = steps.find((step) => step.status === 'failed' || step.status === 'aborted')
  if (firstFailed) {
    hints.push(fill(t('diagHintFirstFailure'), { step: firstFailed.id }))
  }
  const retried = steps.filter((step) => typeof step.attempt === 'number' && step.attempt > 1)
  if (retried.length > 0) {
    hints.push(fill(t('diagHintRetried'), {
      count: retried.length,
      steps: retried.map((step) => step.id).join(', '),
    }))
  }
  const compensated = steps.filter((step) =>
    (step.dispatches ?? []).some((dispatch) => dispatch.phase === 'compensate'),
  )
  if (compensated.length > 0) {
    hints.push(fill(t('diagHintCompensated'), {
      steps: compensated.map((step) => step.id).join(', '),
    }))
  }
  const timeoutSteps = steps.filter((step) => {
    const errors = [step.error ?? '', ...(step.dispatches ?? []).map((dispatch) => dispatch.error ?? '')]
      .join('\n')
      .toLowerCase()
    return errors.includes('timeout') || errors.includes('etimedout') || errors.includes('timed out')
  })
  if (timeoutSteps.length > 0) {
    hints.push(fill(t('diagHintTimeout'), {
      steps: timeoutSteps.map((step) => step.id).join(', '),
    }))
  }
  const pending = steps.filter((step) => step.status === 'pending' || step.status === 'running')
  if (pending.length > 0) {
    hints.push(fill(t('diagHintIncomplete'), {
      count: pending.length,
      steps: pending.map((step) => step.id).join(', '),
    }))
  }
  if (hints.length === 0) hints.push(t('diagHintClean'))
  return hints
}

function timelineLines(entries: readonly NarrativeEntry[]): string[] {
  return entries.map((entry) => {
    const ts = entry.ts ? `\`${entry.ts}\`` : '—'
    const step = entry.stepId ? ` **${entry.stepId}**` : ''
    const attempt = entry.attempt ? ` (attempt ${entry.attempt})` : ''
    const duration = entry.durationMs !== undefined
      ? formatDuration(entry.durationMs)
      : undefined
    const dur = duration ? ` · ${duration}` : ''
    const raw = entry.raw ? `\n${codeBlock(entry.raw)}` : ''
    return `- ${ts}${step}${attempt}${dur} — ${entry.title}${raw}`
  })
}

/**
 * Human-readable run diagnostic report. Doubles as the context block handed to
 * the AI diagnosis flow (`buildDiagnosisPrompt`).
 */
export function buildRunDiagnosticMarkdown(input: {
  run: WorkflowRunView
  transcript: readonly WorkflowTranscriptEventView[]
  workflow?: WorkflowView | null
  t: DiagnosticTranslate
  options?: RunDiagnosticOptions
}): string {
  const { run, transcript, workflow, t } = input
  const options = input.options ?? {}
  const maxOutputChars = options.includeFullOutputs
    ? Number.MAX_SAFE_INTEGER
    : (options.maxOutputCharsPerStep ?? DEFAULT_MAX_OUTPUT_CHARS)
  const generatedAt = options.generatedAt ?? new Date().toISOString()
  const steps = run.steps ?? []
  const typeById = new Map<string, string>()
  for (const def of workflow?.steps ?? []) typeById.set(def.id, def.type)
  const total = steps.length
  const done = steps.filter((step) => step.status === 'completed' || step.status === 'skipped').length
  const runDuration = run.startedAt && run.completedAt
    ? safeDuration(run.startedAt, run.completedAt)
    : undefined

  const out: string[] = []
  out.push(`# ${fill(t('diagTitle'), { workflow: run.workflowName, run: run.id })}`)
  out.push('')
  out.push(`> ${t('diagGeneratedAt')}: ${generatedAt}`)
  out.push('')

  // 1. Overview
  out.push(`## ${t('diagSectionOverview')}`)
  out.push('')
  out.push('| field | value |')
  out.push('| --- | --- |')
  out.push(`| workflow | ${cell(run.workflowName)} |`)
  if (workflow?.title) out.push(`| title | ${cell(workflow.title)} |`)
  out.push(`| run | ${cell(run.id)} |`)
  out.push(`| status | ${cell(statusText(run.status, t))} |`)
  if (run.startedAt) out.push(`| started | ${cell(run.startedAt)} |`)
  if (run.completedAt) out.push(`| completed | ${cell(run.completedAt)} |`)
  out.push(`| duration | ${cell(formatDuration(runDuration))} |`)
  out.push(`| progress | ${cell(`${done}/${total}`)} |`)
  if (run.error) out.push(`| error | ${cell(truncateText(run.error, 400))} |`)
  const params = paramLine(run.params)
  if (params) {
    out.push('')
    out.push(`**${t('diagParams')}**`)
    out.push('')
    out.push(codeBlock(params))
  }
  out.push('')

  // 2. Step diagnostics
  out.push(`## ${t('diagSectionSteps')}`)
  out.push('')
  if (steps.length === 0) {
    out.push(`_${t('diagNone')}_`)
  } else {
    out.push('| step | type | status | attempts | duration | dispatches | error |')
    out.push('| --- | --- | --- | --- | --- | --- | --- |')
    for (const step of steps) {
      const dispatches = step.dispatches ?? []
      out.push(
        `| ${cell(step.id)} | ${cell(typeById.get(step.id))} | ${cell(statusText(step.status, t))} | ` +
        `${cell(step.attempt)} | ${cell(formatDuration(stepDuration(step)))} | ` +
        `${cell(dispatches.length)} | ${cell(step.error ? truncateText(step.error, 160) : undefined)} |`,
      )
    }
  }
  out.push('')

  // 3. Failures & retries
  out.push(`## ${t('diagSectionFailures')}`)
  out.push('')
  const focus = interestingSteps(steps)
  if (focus.length === 0) {
    out.push(`_${t('diagNone')}_`)
  } else {
    for (const step of focus) {
      out.push(`### \`${step.id}\` — ${statusText(step.status, t)}`)
      out.push('')
      out.push(`- type: ${cell(typeById.get(step.id))}`)
      if (step.attempt !== undefined) out.push(`- attempts: ${step.attempt}`)
      const duration = formatDuration(stepDuration(step))
      if (duration) out.push(`- duration: ${duration}`)
      if (step.error) {
        out.push('')
        out.push(`**error**`)
        out.push('')
        out.push(codeBlock(truncateText(step.error, maxOutputChars)))
      }
      if (step.output) {
        out.push('')
        out.push(`**output**`)
        out.push('')
        out.push(codeBlock(truncateText(step.output, maxOutputChars)))
      }
      const dispatches = step.dispatches ?? []
      if (dispatches.length > 0) {
        out.push('')
        out.push('| dispatch | attempt | phase | status | duration | error |')
        out.push('| --- | --- | --- | --- | --- | --- |')
        for (const dispatch of dispatches) {
          out.push(
            `| ${cell(dispatch.id)} | ${cell(dispatch.attempt)} | ${cell(dispatch.phase)} | ` +
            `${cell(dispatch.status)} | ${cell(formatDuration(dispatchDuration(dispatch)))} | ` +
            `${cell(dispatch.error ? truncateText(dispatch.error, 200) : undefined)} |`,
          )
        }
      }
      out.push('')
    }
  }
  out.push('')

  // 4. Timeline
  out.push(`## ${t('diagSectionTimeline')}`)
  out.push('')
  const entries = buildNarrative(steps, transcript, t)
  if (entries.length === 0) {
    out.push(`_${t('diagTimelineEmpty')}_`)
  } else {
    out.push(...timelineLines(entries))
  }
  out.push('')

  // 5. Gates
  out.push(`## ${t('diagSectionGates')}`)
  out.push('')
  const gates = run.gates ?? []
  const workflowGates = (workflow?.steps ?? []).filter((step) => step.type === 'approval')
  if (gates.length === 0 && workflowGates.length === 0) {
    out.push(`_${t('diagNone')}_`)
  } else {
    for (const gate of gates) {
      out.push(`- \`${gate.stepId}\` **${t('diagGatePending')}**: ${cell(gate.question)}`)
      const options = gate.options.join(' / ')
      if (options) out.push(`  - options: ${options}${gate.pass?.length ? ` (pass: ${gate.pass.join(' / ')})` : ''}`)
    }
    for (const step of workflowGates) {
      const already = gates.some((gate) => gate.stepId === step.id)
      if (already) continue
      out.push(`- \`${step.id}\`: ${cell(step.question ?? '—')}`)
      if (step.options?.length) {
        out.push(`  - options: ${step.options.join(' / ')}${step.pass?.length ? ` (pass: ${step.pass.join(' / ')})` : ''}`)
      }
    }
  }
  out.push('')

  // 6. Advice + the AI fix instruction
  out.push(`## ${t('diagSectionAdvice')}`)
  out.push('')
  for (const hint of buildAdviceHints(steps, t)) out.push(`- ${hint}`)
  out.push('')
  out.push(t('diagAdviceRequest'))
  out.push('')

  return out.join('\n')
}

/**
 * Wrap the diagnostic markdown in an instruction asking the design LLM for a
 * repaired / optimized workflow YAML. Fed to `api.designWorkflow` with
 * `mode: 'modify'` and the current workflow YAML.
 */
export function buildDiagnosisPrompt(input: {
  markdown: string
  workflowName: string
  runId: string
  t: DiagnosticTranslate
}): string {
  const lead = fill(input.t('aiDiagnosePromptLead'), {
    workflow: input.workflowName,
    run: input.runId,
  })
  return `${lead}\n\n${input.markdown}`
}

/**
 * Pin `metadata.uid` + `metadata.name` onto generated YAML so `saveWorkflow`
 * updates the existing document instead of colliding on the name.
 */
export function withWorkflowIdentity(
  yaml: string,
  identity: { uid?: string; name: string },
): string {
  const lines = yaml.split('\n')
  let metaIndex = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (/^metadata:\s*$/.test(lines[i] ?? '')) {
      metaIndex = i
      break
    }
  }
  const nameLine = `  name: ${identity.name}`
  const uidLines = identity.uid ? [`  uid: ${identity.uid}`] : []

  if (metaIndex === -1) {
    // Malformed output — prepend a metadata block so saving stays deterministic.
    return [
      'metadata:',
      ...uidLines,
      nameLine,
      ...lines,
    ].join('\n')
  }

  let end = metaIndex + 1
  while (end < lines.length) {
    const line = lines[end] ?? ''
    if (line.trim() === '') {
      end += 1
      continue
    }
    if (/^\s/.test(line)) {
      end += 1
      continue
    }
    break
  }

  const block = lines.slice(metaIndex + 1, end)
  const next: string[] = []
  let uidWritten = false
  let nameWritten = false
  for (const line of block) {
    if (/^\s+uid:/.test(line)) {
      if (identity.uid && !uidWritten) {
        next.push(`  uid: ${identity.uid}`)
        uidWritten = true
      }
      continue
    }
    if (/^\s+name:/.test(line)) {
      next.push(nameLine)
      nameWritten = true
      continue
    }
    next.push(line)
  }
  if (!nameWritten) next.unshift(nameLine)
  if (identity.uid && !uidWritten) next.unshift(`  uid: ${identity.uid}`)

  return [...lines.slice(0, metaIndex + 1), ...next, ...lines.slice(end)].join('\n')
}

function safeDuration(startedAt: string, completedAt: string): number | undefined {
  const start = Date.parse(startedAt)
  const end = Date.parse(completedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined
  return end - start
}
