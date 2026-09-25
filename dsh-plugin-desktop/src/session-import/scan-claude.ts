/** Claude Code session scanner (`~/.claude/projects/<slug>/<id>.jsonl`). */

import { readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { asRecord, asString, readJsonlHead } from './jsonl.js'
import { claudeSlugToDisplayCwd } from './paths.js'
import type { ExternalSessionSummary } from './types.js'

function extractText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const part of content) {
    const row = asRecord(part)
    if (!row) continue
    if (row.type === 'text' && typeof row.text === 'string') parts.push(row.text)
  }
  return parts.join('\n').trim()
}

function firstUserPreview(path: string): { preview: string; cwd?: string; titleHint?: string } {
  const lines = readJsonlHead(path, 80)
  let cwd: string | undefined
  for (const line of lines) {
    const row = asRecord(line)
    if (!row) continue
    if (!cwd) cwd = asString(row.cwd)
    if (row.type !== 'user') continue
    const message = asRecord(row.message)
    const text = extractText(message?.content)
    if (!text) continue
    return {
      preview: text.slice(0, 160),
      ...(cwd ? { cwd } : {}),
      titleHint: text.slice(0, 72),
    }
  }
  return {
    preview: '',
    ...(cwd ? { cwd } : {}),
  }
}

/** Enumerate Claude Code transcripts under a projects root. */
export function scanClaudeSessions(projectsRoot: string): ExternalSessionSummary[] {
  let projectDirs: string[]
  try {
    projectDirs = readdirSync(projectsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return []
  }

  const out: ExternalSessionSummary[] = []
  for (const slug of projectDirs) {
    const dir = join(projectsRoot, slug)
    let files: string[]
    try {
      files = readdirSync(dir, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
        .map(entry => entry.name)
    } catch {
      continue
    }
    for (const name of files) {
      const sourcePath = join(dir, name)
      let mtimeMs = 0
      try {
        mtimeMs = statSync(sourcePath).mtimeMs
      } catch {
        continue
      }
      const id = basename(name, '.jsonl')
      const { preview, cwd, titleHint } = firstUserPreview(sourcePath)
      out.push({
        id,
        source: 'claude',
        sourcePath,
        title: titleHint ? `[Claude] ${titleHint}` : `[Claude] ${id.slice(0, 8)}`,
        cwd: cwd ?? claudeSlugToDisplayCwd(slug),
        mtimeMs,
        preview,
      })
    }
  }
  return out
}
