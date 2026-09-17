/** Format nested Error.cause / AggregateError chains for Host logs and API clients. */
export function formatWorkflowError(cause: unknown, depth = 0): string {
  if (depth > 6) return '…'
  if (!(cause instanceof Error)) return String(cause)
  const parts = [cause.message]
  if (cause instanceof AggregateError) {
    for (const entry of cause.errors) {
      parts.push(formatWorkflowError(entry, depth + 1))
    }
  }
  const nested = (cause as Error & { cause?: unknown }).cause
  if (nested !== undefined) {
    parts.push(formatWorkflowError(nested, depth + 1))
  }
  return parts.filter(Boolean).join(' ← ')
}
