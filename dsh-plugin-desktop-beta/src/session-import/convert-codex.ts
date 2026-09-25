/** Convert Codex rollout JSONL into imported turns. */

import { basename } from 'node:path'
import { asRecord, asString, readJsonlLines } from './jsonl.js'
import { textFromContentBlocks, truncateTitle } from './text.js'
import type { ConvertResult, ImportedTurn } from './types.js'

function roleOf(row: Record<string, unknown>): 'user' | 'assistant' | null {
  const type = asString(row.type) ?? asString(row.kind) ?? ''
  if (type === 'user' || type === 'user_message' || type === 'message.user') return 'user'
  if (type === 'assistant' || type === 'agent_message' || type === 'message.assistant') return 'assistant'
  const payload = asRecord(row.payload) ?? row
  const role = asString(payload.role) ?? asString(asRecord(payload.message)?.role)
  if (role === 'user') return 'user'
  if (role === 'assistant' || role === 'agent') return 'assistant'
  return null
}

function contentOf(row: Record<string, unknown>): unknown {
  const payload = asRecord(row.payload) ?? row
  if (payload.content !== undefined) return payload.content
  if (typeof payload.text === 'string') return payload.text
  const message = asRecord(payload.message)
  if (message?.content !== undefined) return message.content
  // Codex event item wrappers
  const item = asRecord(payload.item) ?? asRecord(row.item)
  if (item) {
    if (typeof item.text === 'string') return item.text
    if (item.content !== undefined) return item.content
  }
  return undefined
}

/** Convert one Codex rollout file into text turns. */
export function convertCodexSession(sourcePath: string): ConvertResult {
  const lines = readJsonlLines(sourcePath)
  const turns: ImportedTurn[] = []
  const warnings: string[] = []
  let cwd: string | undefined
  let title: string | undefined
  let skippedTools = 0
  let skippedThinking = 0

  for (const line of lines) {
    const row = asRecord(line)
    if (!row) continue
    const type = asString(row.type) ?? asString(row.kind) ?? ''
    const payload = asRecord(row.payload) ?? asRecord(row.meta) ?? row
    if (type === 'session_meta' || type === 'session-meta' || payload.cwd !== undefined) {
      cwd = asString(payload.cwd) ?? cwd
      title = asString(payload.title) ?? asString(payload.thread_name) ?? title
    }
    const role = roleOf(row)
    if (!role) continue
    const { text, skippedTools: tools, skippedThinking: thinking } = textFromContentBlocks(contentOf(row))
    skippedTools += tools
    skippedThinking += thinking
    if (!text) continue
    const timeRaw = asString(row.timestamp) ?? asString(payload.timestamp)
    const timeMs = timeRaw ? Date.parse(timeRaw) || Date.now() : Date.now()
    turns.push({ role, text, timeMs })
  }

  if (skippedTools > 0) warnings.push(`Collapsed ${skippedTools} tool block(s) into labels.`)
  if (skippedThinking > 0) warnings.push(`Skipped ${skippedThinking} thinking block(s).`)
  if (turns.length === 0) warnings.push('No user/assistant text turns found.')

  const firstUser = turns.find(turn => turn.role === 'user')?.text ?? ''
  const id = basename(sourcePath).replace(/\.jsonl$/, '')
  return {
    turns,
    cwd,
    title: title
      ? `[Codex] ${truncateTitle(title)}`
      : firstUser
        ? `[Codex] ${truncateTitle(firstUser)}`
        : `[Codex] ${id.slice(0, 24)}`,
    warnings,
  }
}
