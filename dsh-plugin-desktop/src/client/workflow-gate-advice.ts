import type {
  PendingGateView,
  WorkflowRunView,
  WorkflowTranscriptEventView,
} from './desktop-workflow-api.js'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import { buildRunDiagnosticMarkdown } from './workflow-run-diagnostic.js'

export type GateAdviceRecommendation = 'approve' | 'reject' | 'uncertain'

export interface GateAdvice {
  recommendation: GateAdviceRecommendation
  reason: string
}

export interface GateAdviceInput {
  run: WorkflowRunView
  transcript: readonly WorkflowTranscriptEventView[]
  gate: PendingGateView
  /** Step type map (stepId → type) for the diagnostic section headers. */
  workflowTitle?: string
  t: (key: WorkflowLocaleKey) => string
}

/**
 * Build the approval-advice prompt. The run diagnostic is reused verbatim as
 * evidence; the reply is constrained to a two-field YAML document so the answer
 * stays machine-readable without a new host op (the design completion already
 * returns canonicalized YAML).
 */
export function buildGateAdvicePrompt(input: GateAdviceInput): string {
  const evidence = buildRunDiagnosticMarkdown({
    run: input.run,
    transcript: input.transcript,
    workflow: input.workflowTitle ? { name: input.run.workflowName, title: input.workflowTitle, steps: [] } : null,
    t: input.t,
  })
  return [
    'You are a workflow approval advisor. A human holds the final decision;',
    'you only advise. Base the advice strictly on the run evidence below.',
    '',
    `## Pending approval`,
    `- workflow: ${input.run.workflowName}`,
    `- step: ${input.gate.stepId}`,
    `- question: ${input.gate.question}`,
    `- options: ${input.gate.options.join(' / ')}`,
    input.gate.pass?.length ? `- pass decisions: ${input.gate.pass.join(' / ')}` : '- pass decisions: (defaults)',
    '',
    'Answer with ONLY a YAML document in a fenced ```yaml block, exactly:',
    '```yaml',
    'recommendation: approve | reject | uncertain',
    'reason: one short sentence in the user\'s language',
    '```',
    'Use `approve` when the evidence supports continuing, `reject` when it does not,',
    'and `uncertain` when the run evidence is insufficient to advise either way.',
    '',
    '## Run evidence',
    evidence,
  ].join('\n')
}

/** Recommendation values the advisor may emit (kept strict so typos do not decide). */
const RECOMMENDATIONS = new Set<GateAdviceRecommendation>(['approve', 'reject', 'uncertain'])

/**
 * Parse the advisor's two-field YAML reply. Line-oriented on purpose: the reply
 * is a flat document and the client bundles no YAML parser.
 * @param text - raw completion text (with or without a fence).
 * @returns the advice, or null when the reply is not the expected shape.
 */
export function parseGateAdvice(text: string): GateAdvice | null {
  const fenced = /```(?:yaml)?\s*([\s\S]*?)```/i.exec(text)
  const body = fenced?.[1] ?? text
  let recommendation: GateAdviceRecommendation | null = null
  let reason = ''
  for (const line of body.split('\n')) {
    const rec = /^\s*recommendation\s*:\s*(.+?)\s*$/i.exec(line)
    if (rec) {
      const value = rec[1]!.replace(/^['"]|['"]$/g, '').trim().toLowerCase()
      if (RECOMMENDATIONS.has(value as GateAdviceRecommendation)) {
        recommendation = value as GateAdviceRecommendation
      }
      continue
    }
    const why = /^\s*reason\s*:\s*(.+?)\s*$/i.exec(line)
    if (why) {
      reason = why[1]!.replace(/^['"]|['"]$/g, '').trim()
    }
  }
  if (recommendation === null) return null
  return { recommendation, reason }
}

/**
 * The gate option the advice leans toward, for a subtle highlight only — the
 * buttons stay plain so the human's decision is never pre-pressed.
 * @param gate - the pending approval.
 * @param advice - parsed advisor output.
 * @returns the option id, or null when the advice is `uncertain`.
 */
export function recommendedOption(
  gate: { options: readonly string[]; pass?: readonly string[] },
  advice: GateAdvice,
): string | null {
  if (advice.recommendation === 'uncertain') return null
  const pass = new Set(gate.pass ?? [])
  const matches = gate.options.filter(option =>
    advice.recommendation === 'approve' ? pass.has(option) : !pass.has(option))
  return matches[0] ?? null
}
