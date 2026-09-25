/** Convert OpenCode JSON (or SQLite-backed) sessions into imported turns. */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { asRecord, asString } from './jsonl.js'
import { truncateTitle } from './text.js'
import type { ConvertResult, ImportedTurn } from './types.js'

const require = createRequire(import.meta.url)

function readJson(path: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(readFileSync(path, 'utf8')) as unknown)
  } catch {
    return null
  }
}

function partsText(dataDir: string, messageId: string): string {
  const partDir = join(dataDir, 'storage', 'part', messageId)
  let names: string[]
  try {
    names = readdirSync(partDir).filter(name => name.endsWith('.json'))
  } catch {
    return ''
  }
  const texts: string[] = []
  let tools = 0
  for (const name of names.sort()) {
    const part = readJson(join(partDir, name))
    if (!part) continue
    if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
      texts.push(part.text.trim())
    } else if (part.type === 'tool' || part.type === 'tool-invocation' || part.type === 'tool-result') {
      tools += 1
      const toolName = asString(part.tool) ?? asString(part.name) ?? 'tool'
      texts.push(`[${toolName}]`)
    }
  }
  return texts.join('\n').trim()
}

function convertFromJsonStorage(sessionPath: string): ConvertResult {
  const session = readJson(sessionPath)
  const id = asString(session?.id) ?? basename(sessionPath, '.json')
  const title = asString(session?.title) ?? id
  const cwd = asString(session?.directory) ?? asString(session?.cwd)
  // sessionPath: .../storage/session/<project>/<id>.json → dataDir is three levels up from file? 
  // .../storage/session/global/ses_x.json → dataDir = dirname^3 = opencode root
  const dataDir = dirname(dirname(dirname(dirname(sessionPath))))
  const msgDir = join(dataDir, 'storage', 'message', id)
  const warnings: string[] = []
  const turns: ImportedTurn[] = []

  let names: string[]
  try {
    names = readdirSync(msgDir).filter(name => name.startsWith('msg_') && name.endsWith('.json'))
  } catch {
    return {
      turns: [],
      cwd,
      title: `[OpenCode] ${truncateTitle(title)}`,
      warnings: ['Message directory missing.'],
    }
  }

  const messages = names.map(name => {
    const path = join(msgDir, name)
    const row = readJson(path)
    const time = asRecord(row?.time)
    const created = typeof time?.created === 'number' ? time.created : 0
    return { name, row, created }
  }).filter(entry => entry.row !== null)
    .sort((a, b) => a.created - b.created)

  let toolLabels = 0
  for (const entry of messages) {
    const row = entry.row!
    const roleRaw = asString(row.role)
    if (roleRaw !== 'user' && roleRaw !== 'assistant') continue
    const messageId = asString(row.id) ?? basename(entry.name, '.json')
    let text = partsText(dataDir, messageId)
    if (!text && typeof row.content === 'string') text = row.content.trim()
    if (text.includes('[')) toolLabels += 1
    if (!text) continue
    turns.push({
      role: roleRaw,
      text,
      timeMs: entry.created || Date.now(),
    })
  }

  if (toolLabels > 0) warnings.push('Some tool parts were collapsed into labels.')
  if (turns.length === 0) warnings.push('No user/assistant text turns found.')

  return {
    turns,
    cwd,
    title: `[OpenCode] ${truncateTitle(title)}`,
    warnings,
  }
}

function convertFromSqlite(dbPath: string, sessionId: string): ConvertResult {
  let DatabaseSync: typeof import('node:sqlite').DatabaseSync
  try {
    DatabaseSync = (require('node:sqlite') as typeof import('node:sqlite')).DatabaseSync
  } catch {
    return {
      turns: [],
      title: `[OpenCode] ${sessionId.slice(0, 8)}`,
      warnings: ['node:sqlite unavailable for OpenCode DB import.'],
    }
  }

  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const session = db.prepare('SELECT id, title, directory FROM session WHERE id = ?').get(sessionId) as
      | Record<string, unknown>
      | undefined
    const title = asString(session?.title) ?? sessionId
    const cwd = asString(session?.directory)
    const messages = db.prepare(
      `SELECT id, role, time_created FROM message WHERE session_id = ? ORDER BY time_created ASC`,
    ).all(sessionId) as Array<Record<string, unknown>>

    const turns: ImportedTurn[] = []
    const warnings: string[] = []
    for (const message of messages) {
      const roleRaw = asString(message.role)
      if (roleRaw !== 'user' && roleRaw !== 'assistant') continue
      const messageId = asString(message.id)
      if (!messageId) continue
      const parts = db.prepare(
        `SELECT type, text FROM part WHERE message_id = ? ORDER BY id ASC`,
      ).all(messageId) as Array<Record<string, unknown>>
      const texts: string[] = []
      for (const part of parts) {
        if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
          texts.push(part.text.trim())
        } else if (part.type === 'tool' || part.type === 'tool-invocation') {
          texts.push('[tool]')
        }
      }
      const text = texts.join('\n').trim()
      if (!text) continue
      const timeMs = typeof message.time_created === 'number' ? message.time_created : Date.now()
      turns.push({ role: roleRaw, text, timeMs })
    }
    if (turns.length === 0) warnings.push('No user/assistant text turns found in SQLite.')
    return {
      turns,
      cwd,
      title: `[OpenCode] ${truncateTitle(title)}`,
      warnings,
    }
  } catch (error) {
    return {
      turns: [],
      title: `[OpenCode] ${sessionId.slice(0, 8)}`,
      warnings: [error instanceof Error ? error.message : 'SQLite read failed'],
    }
  } finally {
    db.close()
  }
}

/** Convert one OpenCode session (JSON file or SQLite id+db path). */
export function convertOpencodeSession(sourcePath: string, sessionId?: string): ConvertResult {
  if (sourcePath.endsWith('.db') && sessionId) {
    return convertFromSqlite(sourcePath, sessionId)
  }
  if (existsSync(sourcePath) && sourcePath.endsWith('.json')) {
    return convertFromJsonStorage(sourcePath)
  }
  return {
    turns: [],
    title: `[OpenCode] ${sessionId ?? 'unknown'}`,
    warnings: ['Unsupported OpenCode source path.'],
  }
}
