/** Tiny JSONL helpers for harness transcript readers. */

import { readFileSync, statSync } from 'node:fs'

export function readJsonlLines(path: string, maxBytes = 8 * 1024 * 1024): unknown[] {
  const size = statSync(path).size
  const raw = readFileSync(path, 'utf8').slice(0, Math.min(size, maxBytes))
  const out: unknown[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed) as unknown)
    } catch {
      // Skip malformed lines; converters tolerate partial transcripts.
    }
  }
  return out
}

export function readJsonlHead(path: string, maxLines: number, maxBytes = 256 * 1024): unknown[] {
  const raw = readFileSync(path, 'utf8').slice(0, maxBytes)
  const out: unknown[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed) as unknown)
    } catch {
      continue
    }
    if (out.length >= maxLines) break
  }
  return out
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
