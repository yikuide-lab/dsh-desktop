/** AI-assisted usage schedule orchestration. */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { hostServicesFromContext } from '../desktop-workflow-executor.ts'
import { addDays, daysBetween, localDateString } from './dates.js'
import {
  isUsageScheduleRole,
  type TimeMasterContextSnapshot,
  type TokenPlan,
  type UsageScheduleDraft,
  type UsageScheduleItem,
} from './types.js'

const SYSTEM = `You orchestrate AI token/subscription usage schedules for DSH Desktop Time Master.
Return ONLY a single JSON object with keys:
name, horizonDays (number), items (array of { planId, role (primary|backup|burst|idle), windowStart (YYYY-MM-DD), windowEnd (YYYY-MM-DD), dailyBudgetHint?, notes? }), rationale.
Stagger plans so renewals do not cluster. Mark expiring-soon plans as backup or idle.
No markdown fences. Do not modify plan expiresAt values.`

function parseScheduleJson(raw: string, plans: readonly TokenPlan[]): UsageScheduleDraft | null {
  const trimmed = raw.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const row = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>
    const planIds = new Set(plans.map(p => p.id))
    const items: UsageScheduleItem[] = []
    if (Array.isArray(row.items)) {
      for (const entry of row.items) {
        if (!entry || typeof entry !== 'object') continue
        const item = entry as Record<string, unknown>
        const planId = typeof item.planId === 'string' ? item.planId : ''
        const windowStart = typeof item.windowStart === 'string' ? item.windowStart : ''
        const windowEnd = typeof item.windowEnd === 'string' ? item.windowEnd : ''
        const role = isUsageScheduleRole(item.role) ? item.role : 'primary'
        if (!planId || !windowStart || !windowEnd || !planIds.has(planId)) continue
        items.push({
          planId,
          role,
          windowStart,
          windowEnd,
          ...(typeof item.dailyBudgetHint === 'string' ? { dailyBudgetHint: item.dailyBudgetHint } : {}),
          ...(typeof item.notes === 'string' ? { notes: item.notes } : {}),
        })
      }
    }
    if (items.length === 0) return null
    return {
      ...(typeof row.name === 'string' && row.name.trim() ? { name: row.name.trim() } : {}),
      horizonDays: typeof row.horizonDays === 'number' && row.horizonDays > 0 ? row.horizonDays : 30,
      items,
      ...(typeof row.rationale === 'string' ? { rationale: row.rationale } : {}),
    }
  } catch {
    return null
  }
}

/** Heuristic stagger: sort plans by expiresAt, assign non-overlapping windows. */
export function heuristicOrchestrateUsage(input: {
  plans: readonly TokenPlan[]
  context: TimeMasterContextSnapshot
  hint?: string
}): UsageScheduleDraft {
  const today = input.context.today || localDateString()
  const horizonDays = 30
  const windowEnd = addDays(today, horizonDays) ?? today
  const sorted = [...input.plans].sort((a, b) => {
    const da = daysBetween(today, a.expiresAt) ?? 999
    const db = daysBetween(today, b.expiresAt) ?? 999
    return da - db
  })

  const items: UsageScheduleItem[] = []
  let slotStart = today
  for (let i = 0; i < sorted.length; i++) {
    const plan = sorted[i]!
    const remaining = daysBetween(today, plan.expiresAt) ?? horizonDays
    const role = remaining <= 7 ? 'backup' : (remaining <= 14 ? 'burst' : (i === 0 ? 'primary' : 'idle'))
    const span = Math.max(7, Math.min(14, Math.floor(horizonDays / Math.max(sorted.length, 1))))
    const itemEnd = addDays(slotStart, span - 1) ?? windowEnd
    const cappedEnd = daysBetween(itemEnd, windowEnd) !== null && daysBetween(itemEnd, windowEnd)! < 0
      ? windowEnd
      : itemEnd
    items.push({
      planId: plan.id,
      role,
      windowStart: slotStart,
      windowEnd: cappedEnd,
      dailyBudgetHint: role === 'primary' ? 'normal' : 'reduced',
      notes: remaining <= 7 ? `Expires in ${remaining}d — backup tier` : undefined,
    })
    slotStart = addDays(cappedEnd, 1) ?? cappedEnd
    const pastHorizon = daysBetween(slotStart, windowEnd)
    if (pastHorizon !== null && pastHorizon < 0) break
  }

  const hint = input.hint?.trim()
  return {
    name: hint ? `Usage · ${hint}` : `Usage schedule (${today})`,
    horizonDays,
    items,
    rationale: 'Heuristic stagger by plan expiry; near-term plans marked backup/idle.',
  }
}

async function llmOrchestrate(
  ctx: Context,
  plans: readonly TokenPlan[],
  context: TimeMasterContextSnapshot,
  hint: string,
): Promise<UsageScheduleDraft | null> {
  const services = hostServicesFromContext(ctx)
  if (!services) return null

  const user = [
    'Draft a usage schedule for registered token plans.',
    hint ? `User hint: ${hint}` : '',
    '',
    '## Plans',
    JSON.stringify(plans, null, 2),
    '',
    '## Context',
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
      maxTokens: 1200,
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
    return parseScheduleJson(text, plans)
  } catch {
    return null
  }
}

export async function orchestrateUsage(input: {
  ctx: Context
  plans: readonly TokenPlan[]
  context: TimeMasterContextSnapshot
  hint?: string
}): Promise<{ draft: UsageScheduleDraft; source: 'ai' | 'heuristic' }> {
  const hint = input.hint?.trim() ?? ''
  if (input.plans.length === 0) {
    return {
      draft: { name: 'Empty schedule', horizonDays: 30, items: [], rationale: 'No plans registered' },
      source: 'heuristic',
    }
  }
  const ai = await llmOrchestrate(input.ctx, input.plans, input.context, hint)
  if (ai?.name && ai.items && ai.items.length > 0) {
    return { draft: ai, source: 'ai' }
  }
  return {
    draft: heuristicOrchestrateUsage({ plans: input.plans, context: input.context, hint }),
    source: 'heuristic',
  }
}
