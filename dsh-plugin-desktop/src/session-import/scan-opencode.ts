/** OpenCode session scanner (JSON storage + optional SQLite fallback). */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createRequire } from 'node:module'
import { asRecord, asString } from './jsonl.js'
import type { ExternalSessionSummary } from './types.js'

const require = createRequire(import.meta.url)

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(readFileSync(path, 'utf8')) as unknown)
  } catch {
    return null
  }
}

function walkSessionJson(root: string, out: string[]): void {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      walkSessionJson(path, out)
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.json') && entry.name.startsWith('ses_')) {
      out.push(path)
    }
  }
}

function firstUserPreview(dataDir: string, sessionId: string): string {
  const msgDir = join(dataDir, 'storage', 'message', sessionId)
  let files: string[]
  try {
    files = readdirSync(msgDir).filter(name => name.startsWith('msg_') && name.endsWith('.json'))
  } catch {
    return ''
  }
  const sorted = files
    .map(name => {
      const path = join(msgDir, name)
      try {
        return { path, mtime: statSync(path).mtimeMs }
      } catch {
        return null
      }
    })
    .filter((entry): entry is { path: string; mtime: number } => entry !== null)
    .sort((a, b) => a.mtime - b.mtime)
  for (const entry of sorted.slice(0, 24)) {
    const row = readJsonFile(entry.path)
    if (!row || row.role !== 'user') continue
    // Prefer parts text when present.
    const partDir = join(dataDir, 'storage', 'part', basename(entry.path, '.json'))
    try {
      const parts = readdirSync(partDir).filter(name => name.endsWith('.json'))
      const texts: string[] = []
      for (const partName of parts) {
        const part = readJsonFile(join(partDir, partName))
        if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
          texts.push(part.text.trim())
        }
      }
      if (texts.length > 0) return texts.join('\n').slice(0, 160)
    } catch {
      // fall through
    }
    if (typeof row.content === 'string' && row.content.trim()) return row.content.trim().slice(0, 160)
  }
  return ''
}

function scanJsonStorage(dataDir: string): ExternalSessionSummary[] {
  const sessionRoot = join(dataDir, 'storage', 'session')
  const files: string[] = []
  walkSessionJson(sessionRoot, files)
  const out: ExternalSessionSummary[] = []
  for (const sourcePath of files) {
    const row = readJsonFile(sourcePath)
    if (!row) continue
    const id = asString(row.id) ?? basename(sourcePath, '.json')
    const time = asRecord(row.time)
    const created = typeof time?.created === 'number' ? time.created : 0
    const updated = typeof time?.updated === 'number' ? time.updated : created
    let mtimeMs = updated
    try {
      mtimeMs = Math.max(updated, statSync(sourcePath).mtimeMs)
    } catch {
      // keep updated
    }
    const title = asString(row.title) ?? id
    const cwd = asString(row.directory) ?? asString(row.cwd)
    out.push({
      id,
      source: 'opencode',
      sourcePath,
      title: `[OpenCode] ${title}`,
      ...(cwd ? { cwd } : {}),
      mtimeMs,
      preview: firstUserPreview(dataDir, id) || title,
    })
  }
  return out
}

function scanSqlite(dataDir: string): ExternalSessionSummary[] {
  const candidates = [
    join(dataDir, 'opencode.db'),
    ...safeList(dataDir).filter(name => /^opencode.*\.db$/.test(name)).map(name => join(dataDir, name)),
  ]
  const unique = [...new Set(candidates)].filter(path => existsSync(path))
  if (unique.length === 0) return []

  let DatabaseSync: typeof import('node:sqlite').DatabaseSync
  try {
    DatabaseSync = (require('node:sqlite') as typeof import('node:sqlite')).DatabaseSync
  } catch {
    return []
  }

  const out: ExternalSessionSummary[] = []
  for (const dbPath of unique) {
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true })
      try {
        const rows = db.prepare(
          `SELECT id, title, directory, time_created, time_updated FROM session ORDER BY time_updated DESC LIMIT 2000`,
        ).all() as Array<Record<string, unknown>>
        for (const row of rows) {
          const id = asString(row.id)
          if (!id) continue
          const title = asString(row.title) ?? id
          const created = typeof row.time_created === 'number' ? row.time_created : 0
          const updated = typeof row.time_updated === 'number' ? row.time_updated : created
          const cwd = asString(row.directory)
          out.push({
            id,
            source: 'opencode',
            sourcePath: dbPath,
            title: `[OpenCode] ${title}`,
            ...(cwd ? { cwd } : {}),
            mtimeMs: updated,
            preview: title,
          })
        }
      } finally {
        db.close()
      }
    } catch {
      // Schema drift / locked DB — skip this file.
    }
  }
  return out
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/** Enumerate OpenCode sessions from JSON storage, falling back to SQLite. */
export function scanOpencodeSessions(dataDir: string): ExternalSessionSummary[] {
  const fromJson = scanJsonStorage(dataDir)
  if (fromJson.length > 0) return fromJson
  return scanSqlite(dataDir)
}
