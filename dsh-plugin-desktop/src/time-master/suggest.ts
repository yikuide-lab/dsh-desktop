/** AI-assisted (or heuristic) draft fill for Time Master forms. */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { hostServicesFromContext } from '../desktop-workflow-executor.ts'
import { DEFAULT_REMIND_DAYS, isTokenPlanCycle, type TokenPlanDraft, type TimeMasterContextSnapshot } from './types.js'
import { heuristicSuggest } from './templates.js'
import { addDays, localDateString } from './dates.js'

const SYSTEM = `You help the user register AI coding token/subscription plans in DSH Desktop Time Master.
Return ONLY a single JSON object with keys:
name, providerHint, cycle (monthly|yearly|custom), startsAt (YYYY-MM-DD), expiresAt (YYYY-MM-DD), remindDays (number[]), notes.
No markdown fences. Prefer realistic renewal dates from today. Do not invent API keys.`

function parseDraftJson(raw: string): TokenPlanDraft | null {
  const trimmed = raw.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const row = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>
    const today = localDateString()
    const cycle = isTokenPlanCycle(row.cycle) ? row.cycle : 'monthly'
    const expiresAt = typeof row.expiresAt === 'string' && row.expiresAt
      ? row.expiresAt
      : (addDays(today, cycle === 'yearly' ? 365 : 30) ?? today)
    const remindDays = Array.isArray(row.remindDays)
      ? row.remindDays.filter((day): day is number => typeof day === 'number' && day >= 0)
      : [...DEFAULT_REMIND_DAYS]
    return {
      ...(typeof row.name === 'string' && row.name.trim() ? { name: row.name.trim() } : {}),
      ...(typeof row.providerHint === 'string' && row.providerHint.trim()
        ? { providerHint: row.providerHint.trim() }
        : {}),
      cycle,
      ...(typeof row.startsAt === 'string' && row.startsAt.trim()
        ? { startsAt: row.startsAt.trim() }
        : { startsAt: today }),
      expiresAt,
      remindDays: remindDays.length > 0 ? remindDays : [...DEFAULT_REMIND_DAYS],
      ...(typeof row.notes === 'string' && row.notes.trim() ? { notes: row.notes.trim() } : {}),
    }
  } catch {
    return null
  }
}

async function llmSuggest(
  ctx: Context,
  context: TimeMasterContextSnapshot,
  hint: string,
): Promise<TokenPlanDraft | null> {
  const services = hostServicesFromContext(ctx)
  if (!services) return null

  const user = [
    'Draft one token/subscription plan registration.',
    hint ? `User hint: ${hint}` : 'No user hint; pick the most likely plan from context.',
    '',
    '## Context JSON',
    JSON.stringify(context, null, 2),
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
      maxTokens: 800,
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
    return parseDraftJson(text)
  } catch {
    return null
  }
}

/** Prefer Host LLM draft; fall back to deterministic templates. */
export async function suggestTokenPlan(input: {
  ctx: Context
  context: TimeMasterContextSnapshot
  hint?: string
}): Promise<{ draft: TokenPlanDraft; source: 'ai' | 'heuristic' }> {
  const hint = input.hint?.trim() ?? ''
  const ai = await llmSuggest(input.ctx, input.context, hint)
  if (ai?.name && ai.expiresAt) {
    return { draft: ai, source: 'ai' }
  }
  return {
    draft: heuristicSuggest({ context: input.context, hint }),
    source: 'heuristic',
  }
}
