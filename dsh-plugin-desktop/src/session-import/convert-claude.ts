/** Convert Claude Code JSONL transcripts into imported turns. */

import { basename } from 'node:path'
import { asRecord, asString, readJsonlLines } from './jsonl.js'
import { textFromContentBlocks, truncateTitle } from './text.js'
import type { ConvertResult, ImportedTurn } from './types.js'

/** Convert one Claude Code transcript file into text turns. */
export function convertClaudeSession(sourcePath: string): ConvertResult {
  const lines = readJsonlLines(sourcePath)
  const turns: ImportedTurn[] = []
  const warnings: string[] = []
  let cwd: string | undefined
  let skippedTools = 0
  let skippedThinking = 0

  for (const line of lines) {
    const row = asRecord(line)
    if (!row) continue
    if (!cwd) cwd = asString(row.cwd)
    if (row.type !== 'user' && row.type !== 'assistant') continue
    const message = asRecord(row.message)
    if (!message) continue
    const { text, skippedTools: tools, skippedThinking: thinking } = textFromContentBlocks(message.content)
    skippedTools += tools
    skippedThinking += thinking
    if (!text) continue
    const timeMs = Date.parse(asString(row.timestamp) ?? '') || Date.now()
    turns.push({
      role: row.type === 'user' ? 'user' : 'assistant',
      text,
      timeMs,
    })
  }

  if (skippedTools > 0) warnings.push(`Collapsed ${skippedTools} tool block(s) into labels.`)
  if (skippedThinking > 0) warnings.push(`Skipped ${skippedThinking} thinking block(s).`)
  if (turns.length === 0) warnings.push('No user/assistant text turns found.')

  const firstUser = turns.find(turn => turn.role === 'user')?.text ?? ''
  const id = basename(sourcePath, '.jsonl')
  return {
    turns,
    cwd,
    title: firstUser ? `[Claude] ${truncateTitle(firstUser)}` : `[Claude] ${id.slice(0, 8)}`,
    warnings,
  }
}
