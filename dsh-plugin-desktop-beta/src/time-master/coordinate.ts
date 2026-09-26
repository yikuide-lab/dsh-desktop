/** AI-assisted coordination suggestions. */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { hostServicesFromContext } from '../desktop-workflow-executor.ts'
import type { CoordSuggestion } from './types.js'
import { heuristicCoordinate, type CoordSnapshot } from './coord.js'
import type { ProjectPlan } from './types.js'

const SYSTEM = `You resolve scheduling conflicts for DSH Desktop Time Master.
Return ONLY a JSON array of objects: { taskId, field (dueAt|sessionId|workflowName|planId), value, reason }.
taskId format is "projectId:taskId". Do not invent task ids.
No markdown fences.`

function parseSuggestionsJson(raw: string): CoordSuggestion[] | null {
  const trimmed = raw.trim()
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const rows = JSON.parse(trimmed.slice(start, end + 1)) as unknown[]
    const out: CoordSuggestion[] = []
    for (const entry of rows) {
      if (!entry || typeof entry !== 'object') continue
      const row = entry as Record<string, unknown>
      const taskId = typeof row.taskId === 'string' ? row.taskId : ''
      const field = row.field
      const value = typeof row.value === 'string' ? row.value : ''
      const reason = typeof row.reason === 'string' ? row.reason : ''
      if (!taskId || !reason) continue
      if (field !== 'dueAt' && field !== 'sessionId' && field !== 'workflowName' && field !== 'planId') continue
      out.push({ taskId, field, value, reason })
    }
    return out.length > 0 ? out : null
  } catch {
    return null
  }
}

async function llmCoordinate(
  ctx: Context,
  snapshot: CoordSnapshot,
): Promise<CoordSuggestion[] | null> {
  const services = hostServicesFromContext(ctx)
  if (!services) return null

  const user = [
    'Suggest fixes for these scheduling conflicts.',
    '',
    '## Snapshot',
    JSON.stringify(snapshot, null, 2),
  ].join('\n')

  try {
    const selection = services.agentDefaultModel?.currentSelection()
    if (!selection?.provider || !selection?.model) return null
    const messages: Message[] = [createUserMessage({
      content: [{ type: 'text', text: user }],
      source: { kind: 'plugin', plugin: 'dsh-plugin-desktop/time-master' },
    })]
    const options: GenerateOptions = {
      provider: selection.provider,
      model: selection.model,
      messages,
      system: SYSTEM,
      maxTokens: 1000,
      signal: new AbortController().signal,
    }
    const assembler = new BlockAssembler()
    for await (const chunk of services.llm.stream(options)) {
      assembler.push(chunk)
    }
    const text = assembler.blocks()
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim()
    return parseSuggestionsJson(text)
  } catch {
    return null
  }
}

export async function coordinateTasks(input: {
  ctx: Context
  snapshot: CoordSnapshot
  projects: readonly ProjectPlan[]
}): Promise<{ suggestions: CoordSuggestion[]; source: 'ai' | 'heuristic' }> {
  if (input.snapshot.conflicts.length === 0) {
    return { suggestions: [], source: 'heuristic' }
  }
  const ai = await llmCoordinate(input.ctx, input.snapshot)
  if (ai && ai.length > 0) {
    return { suggestions: ai, source: 'ai' }
  }
  return {
    suggestions: heuristicCoordinate({ snapshot: input.snapshot, projects: input.projects }),
    source: 'heuristic',
  }
}
