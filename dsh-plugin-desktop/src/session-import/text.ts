/** Shared text helpers for harness → turn conversion. */

import { asRecord } from './jsonl.js'

export function textFromContentBlocks(content: unknown): { text: string; skippedTools: number; skippedThinking: number } {
  if (typeof content === 'string') {
    return { text: content.trim(), skippedTools: 0, skippedThinking: 0 }
  }
  if (!Array.isArray(content)) {
    return { text: '', skippedTools: 0, skippedThinking: 0 }
  }
  const parts: string[] = []
  let skippedTools = 0
  let skippedThinking = 0
  for (const part of content) {
    const row = asRecord(part)
    if (!row) continue
    const type = typeof row.type === 'string' ? row.type : ''
    if (type === 'text' && typeof row.text === 'string') {
      parts.push(row.text)
      continue
    }
    if (type === 'thinking' || type === 'reasoning') {
      skippedThinking += 1
      continue
    }
    if (type === 'tool_use' || type === 'tool_result' || type === 'tool-call' || type === 'tool-result') {
      skippedTools += 1
      const name = typeof row.name === 'string' ? row.name : 'tool'
      parts.push(`[${name}]`)
      continue
    }
  }
  return { text: parts.join('\n').trim(), skippedTools, skippedThinking }
}

export function truncateTitle(text: string, max = 72): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, max - 1)}…`
}
