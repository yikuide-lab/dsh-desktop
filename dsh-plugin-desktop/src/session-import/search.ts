/** List / search external harness sessions. */

import { readFileSync } from 'node:fs'
import { resolveSessionImportRoots, type SessionImportRoots } from './paths.js'
import { scanClaudeSessions } from './scan-claude.js'
import { scanCodexSessions } from './scan-codex.js'
import { scanOpencodeSessions } from './scan-opencode.js'
import type { ExternalSessionSource, ExternalSessionSummary } from './types.js'

const ALL_SOURCES: readonly ExternalSessionSource[] = ['claude', 'codex', 'opencode']

/** Collect summaries from the selected harness roots. */
export function listExternalSessions(
  sources: readonly ExternalSessionSource[] = ALL_SOURCES,
  roots: SessionImportRoots = resolveSessionImportRoots(),
): ExternalSessionSummary[] {
  const wanted = new Set(sources.length > 0 ? sources : ALL_SOURCES)
  const out: ExternalSessionSummary[] = []
  if (wanted.has('claude')) out.push(...scanClaudeSessions(roots.claudeProjects))
  if (wanted.has('codex')) out.push(...scanCodexSessions([roots.codexSessions, roots.codexArchived]))
  if (wanted.has('opencode')) out.push(...scanOpencodeSessions(roots.opencodeData))
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

function matchesQuery(summary: ExternalSessionSummary, needle: string): boolean {
  const hay = [
    summary.title,
    summary.preview,
    summary.cwd ?? '',
    summary.id,
    summary.source,
  ].join('\n').toLowerCase()
  return hay.includes(needle)
}

function contentMatches(sourcePath: string, needle: string, maxBytes = 128 * 1024): boolean {
  if (sourcePath.endsWith('.db')) return false
  try {
    const raw = readFileSync(sourcePath, 'utf8').slice(0, maxBytes).toLowerCase()
    return raw.includes(needle)
  } catch {
    return false
  }
}

/** Filter listed sessions by title/cwd/preview (and optional content head). */
export function searchExternalSessions(input: {
  query: string
  sources?: readonly ExternalSessionSource[]
  content?: boolean
  roots?: SessionImportRoots
}): ExternalSessionSummary[] {
  const needle = input.query.trim().toLowerCase()
  const listed = listExternalSessions(input.sources, input.roots)
  if (!needle) return listed
  return listed.filter(summary => (
    matchesQuery(summary, needle)
    || (input.content === true && contentMatches(summary.sourcePath, needle))
  ))
}
