/**
 * RSI review contract: one review + improvement pass over a workflow YAML.
 * Shared by the pure-Node engine (storing verdicts), the Desktop Host executor
 * (streaming LLM), and the headless awf-node runner (chat completions).
 */

/** Input for one RSI review/improve pass over a workflow YAML baseline. */
export interface RsiReviewRequest {
  /** Problem being iterated (for reviewer-side logging). */
  problemId: number
  /** Problem title. */
  title: string
  /** Problem domain tag, e.g. summarization. */
  domain: string
  /** What "better" means for this problem. */
  improvementCriteria: string
  /** 0-based iteration number within the problem. */
  iterationNumber: number
  /** Workflow YAML under review (baseline, or the previous iteration's improvement). */
  yaml: string
  /** Review feedback from the previous iteration, when any. */
  priorFeedback?: string
}

/** Outcome of one RSI review/improve pass. */
export interface RsiReviewResult {
  /** Review score clamped to 0-100. */
  score: number
  /** Review comments, carried into the next iteration as prior feedback. */
  feedback: string
  /** Improved workflow YAML (equals the input when the reviewer found no change). */
  improvedYaml: string
}

/**
 * Host-bound RSI reviewer. Without one the engine falls back to its
 * deterministic stub so the loop stays runnable on pure Node.
 */
export type RsiReviewer = (
  request: RsiReviewRequest,
  signal?: AbortSignal,
) => Promise<RsiReviewResult>

/** Completion budget for one review + improvement response (the improved YAML rides along). */
export const RSI_REVIEW_MAX_TOKENS = 8192

/** Build the system + user prompt for one RSI review pass. */
export function buildRsiReviewPrompt(request: RsiReviewRequest): { system: string; user: string } {
  const system = [
    'You are the reviewer in a workflow self-iteration (RSI) loop.',
    'Review the workflow YAML against the improvement criteria, then produce an improved version.',
    'Respond with a single JSON object and nothing else:',
    '{"score": <0-100 number>, "feedback": "<review comments and what you changed>", "improvedYaml": "<full improved workflow YAML>"}',
  ].join('\n')
  const sections = [
    `## Problem\n\n${request.title} (${request.domain})`,
    `## Iteration\n\n${request.iterationNumber}`,
  ]
  if (request.improvementCriteria.trim()) {
    sections.push(`## Improvement criteria\n\n${request.improvementCriteria}`)
  }
  if (request.priorFeedback?.trim()) {
    sections.push(`## Previous review feedback\n\n${request.priorFeedback}`)
  }
  sections.push(`## Workflow YAML under review\n\n\`\`\`yaml\n${request.yaml}\n\`\`\``)
  return { system, user: sections.join('\n\n') }
}

/** Extract the JSON verdict from a model response, tolerating prose and code fences. */
function extractJsonObject(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(trimmed)
  if (fenced?.[1]?.trim().startsWith('{')) return fenced[1].trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  return trimmed
}

/**
 * Parse a reviewer response into an RsiReviewResult.
 * @param text - Raw model output (bare JSON, fenced JSON, or JSON inside prose).
 * @param fallbackYaml - YAML to keep when the reviewer returns no improvement.
 * @returns The clamped, normalized verdict.
 */
export function parseRsiReviewResponse(text: string, fallbackYaml: string): RsiReviewResult {
  let payload: unknown
  try {
    payload = JSON.parse(extractJsonObject(text))
  } catch {
    throw new Error('rsi review: response is not a JSON verdict')
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('rsi review: response is not a JSON verdict')
  }
  const record = payload as { score?: unknown; feedback?: unknown; improvedYaml?: unknown }
  const rawScore = typeof record.score === 'number' ? record.score : Number(record.score)
  const score = Number.isFinite(rawScore) ? Math.min(100, Math.max(0, rawScore)) : 0
  const feedback = typeof record.feedback === 'string' && record.feedback.trim()
    ? record.feedback.trim()
    : '(no review feedback)'
  const improvedYaml = typeof record.improvedYaml === 'string' && record.improvedYaml.trim()
    ? record.improvedYaml
    : fallbackYaml
  return { score, feedback, improvedYaml }
}
