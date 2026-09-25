/** Codex CLI rollout scanner (~/.codex/sessions/.../rollout-*.jsonl). */

import { readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { asRecord, asString, readJsonlHead } from './jsonl.js'
import type { ExternalSessionSummary } from './types.js'

function walkRollouts(root: string, out: string[]): void {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      walkRollouts(path, out)
      continue
    }
    if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
      out.push(path)
    }
  }
}

function metaFromRollout(path: string): { id: string; cwd?: string; title?: string; preview: string } {
  const lines = readJsonlHead(path, 40)
  let id = basename(path).replace(/^rollout-.*?-/, '').replace(/\.jsonl$/, '')
  let cwd: string | undefined
  let title: string | undefined
  let preview = ''
  for (const line of lines) {
    const row = asRecord(line)
    if (!row) continue
    const type = asString(row.type) ?? asString(row.kind)
    const payload = asRecord(row.payload) ?? asRecord(row.meta) ?? row
    if (type === 'session_meta' || type === 'session-meta' || payload.cwd !== undefined) {
      const sessionId = asString(payload.session_id)
        ?? asString(payload.id)
        ?? asString(payload.sessionId)
      if (sessionId) id = sessionId
      cwd = asString(payload.cwd) ?? cwd
      title = asString(payload.title) ?? asString(payload.thread_name) ?? title
    }
    // Codex message shapes vary; look for plain text user content.
    const content = payload.content ?? payload.text ?? asRecord(payload.message)?.content
    if (!preview && typeof content === 'string' && content.trim()) {
      preview = content.trim().slice(0, 160)
    } else if (!preview && Array.isArray(content)) {
      for (const part of content) {
        const p = asRecord(part)
        if (p && typeof p.text === 'string' && p.text.trim()) {
          preview = p.text.trim().slice(0, 160)
          break
        }
      }
    }
  }
  // Filename fallback: rollout-<ts>-<uuid>.jsonl
  const match = /rollout-[^-]+-[^-]+-[^-]+-[^-]+-([0-9a-f-]{36})/i.exec(basename(path))
    ?? /rollout-.*?-([0-9a-f]{8}-[0-9a-f-]{27,})\.jsonl$/i.exec(basename(path))
  if (match?.[1]) id = match[1]
  return {
    id,
    ...(cwd ? { cwd } : {}),
    ...(title ? { title } : {}),
    preview,
  }
}

/** Enumerate Codex rollout transcripts under sessions and archived roots. */
export function scanCodexSessions(sessionRoots: readonly string[]): ExternalSessionSummary[] {
  const files: string[] = []
  for (const root of sessionRoots) walkRollouts(root, files)
  const out: ExternalSessionSummary[] = []
  for (const sourcePath of files) {
    let mtimeMs = 0
    try {
      mtimeMs = statSync(sourcePath).mtimeMs
    } catch {
      continue
    }
    const meta = metaFromRollout(sourcePath)
    out.push({
      id: meta.id,
      source: 'codex',
      sourcePath,
      title: meta.title ? `[Codex] ${meta.title}` : `[Codex] ${meta.id.slice(0, 8)}`,
      ...(meta.cwd ? { cwd: meta.cwd } : {}),
      mtimeMs,
      preview: meta.preview || meta.title || '',
    })
  }
  return out
}
