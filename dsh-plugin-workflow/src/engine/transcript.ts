/**
 * Append-only workflow run transcripts for interaction tracking.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export type TranscriptEventType =
  | 'run.start'
  | 'run.complete'
  | 'run.fail'
  | 'run.abort'
  | 'run.orphan'
  | 'dispatch.submit'
  | 'dispatch.settle'
  | 'gate.resolve'
  | 'llm.request'
  | 'llm.response'
  | 'task.request'
  | 'task.response'
  | 'script.result'
  | 'error'

export interface TranscriptEvent {
  ts: string
  type: TranscriptEventType
  stepId?: string
  dispatchId?: string
  data?: Record<string, unknown>
}

/** Truncate large strings before persisting transcript payloads. */
export function truncateTranscriptText(value: string, max = 16_000): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n…[truncated ${value.length - max} chars]`
}

/** Build a JSONL transcript path for a run. */
export function transcriptPath(stateDir: string, runId: string): string {
  return join(stateDir, 'runs', `${runId}.transcript.jsonl`)
}

/** Append one transcript event (creates parent dirs as needed). */
export async function appendTranscriptEvent(
  stateDir: string,
  runId: string,
  event: Omit<TranscriptEvent, 'ts'> & { ts?: string },
): Promise<TranscriptEvent> {
  const full: TranscriptEvent = {
    ...event,
    ts: event.ts ?? new Date().toISOString(),
  }
  const path = transcriptPath(stateDir, runId)
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify(full)}\n`, 'utf8')
  return full
}

/** Load transcript events with optional cursor pagination (`after` = last event ts). */
export async function loadTranscriptEvents(
  stateDir: string,
  runId: string,
  options: { after?: string; limit?: number } = {},
): Promise<{ events: TranscriptEvent[]; nextAfter?: string }> {
  const path = transcriptPath(stateDir, runId)
  try {
    const raw = await readFile(path, 'utf8')
    const events: TranscriptEvent[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        events.push(JSON.parse(trimmed) as TranscriptEvent)
      } catch {
        // skip corrupt lines
      }
    }
    const after = typeof options.after === 'string' ? options.after : undefined
    const filtered = after
      ? events.filter((event) => event.ts > after)
      : events
    const limit = typeof options.limit === 'number' && options.limit > 0
      ? Math.floor(options.limit)
      : filtered.length
    const page = filtered.slice(0, limit)
    const last = page[page.length - 1]
    const hasMore = filtered.length > page.length
    return {
      events: page,
      ...(hasMore && last?.ts ? { nextAfter: last.ts } : {}),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { events: [] }
    throw error
  }
}
