/** Unified-seat workflow rows: the armable workflow sources, deduped by name. */

export interface SeatWorkflowEntry {
  name: string
  title: string
}

/**
 * Compose the workflow tab's rows from every armable source: saved workflows,
 * templates, and the platform's public/private summaries. A same-name entry
 * earlier in that order wins, so a local workflow never hides behind its
 * platform twin and a template never shadows a saved workflow.
 */
export function buildSeatWorkflowRows(input: {
  workflows: readonly { name: string; title?: string }[]
  templates: readonly { name: string }[]
  remote: readonly { name: string; title?: string }[]
}): SeatWorkflowEntry[] {
  const seen = new Set<string>()
  const rows: SeatWorkflowEntry[] = []
  for (const entry of [
    ...input.workflows.map(entry => ({ name: entry.name, title: entry.title || entry.name })),
    ...input.templates.map(entry => ({ name: entry.name, title: entry.name })),
    ...input.remote.map(entry => ({ name: entry.name, title: entry.title || entry.name })),
  ]) {
    if (seen.has(entry.name)) continue
    seen.add(entry.name)
    rows.push(entry)
  }
  return rows
}
