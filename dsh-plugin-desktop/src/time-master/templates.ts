/** Built-in plan templates and pure heuristic draft fill. */

import { addDays, localDateString } from './dates.js'
import {
  DEFAULT_REMIND_DAYS,
  type TokenPlanCycle,
  type TokenPlanDraft,
  type TimeMasterContextSnapshot,
} from './types.js'

export const PLAN_TEMPLATES: readonly {
  name: string
  cycle: TokenPlanCycle
  providerHint: string
  notes: string
  days: number
}[] = [
  { name: 'Claude Pro', cycle: 'monthly', providerHint: 'claude', notes: 'Anthropic Claude Code / Pro', days: 30 },
  { name: 'Codex Plus', cycle: 'monthly', providerHint: 'codex', notes: 'OpenAI Codex / ChatGPT Plus-adjacent', days: 30 },
  { name: 'Cursor Pro', cycle: 'monthly', providerHint: 'cursor', notes: 'Cursor IDE subscription', days: 30 },
  { name: 'Kimi 会员', cycle: 'monthly', providerHint: 'kimi', notes: 'Moonshot Kimi coding plan', days: 30 },
  { name: 'OpenCode', cycle: 'monthly', providerHint: 'opencode', notes: 'OpenCode / Zen provider quota', days: 30 },
  { name: 'Qwen Token Plan', cycle: 'monthly', providerHint: 'qwen-token-plan', notes: 'Alibaba qwen-token-plan route', days: 30 },
]

/** Heuristic draft from context + optional user hint (no LLM). */
export function heuristicSuggest(input: {
  context: TimeMasterContextSnapshot
  hint?: string
}): TokenPlanDraft {
  const today = input.context.today || localDateString()
  const hint = (input.hint ?? '').trim().toLowerCase()

  const fromRoute = input.context.tokenPlanRoutes.find(route => (
    !hint || route.toLowerCase().includes(hint) || hint.includes(route.toLowerCase())
  ))
  const fromTemplate = PLAN_TEMPLATES.find(template => (
    (!hint || template.name.toLowerCase().includes(hint) || hint.includes(template.providerHint))
    || (fromRoute !== undefined && (
      fromRoute.toLowerCase().includes(template.providerHint)
      || template.providerHint.includes(fromRoute.split('/')[0] ?? '')
    ))
  )) ?? PLAN_TEMPLATES[0]!

  const provider = input.context.providers.find(entry => (
    entry.id === fromTemplate.providerHint
    || entry.models.some(model => model.toLowerCase().includes(fromTemplate.providerHint))
    || (fromRoute !== undefined && entry.id === fromRoute)
  ))

  const cycleDays = fromTemplate.cycle === 'yearly' ? 365 : fromTemplate.days
  const expiresAt = addDays(today, cycleDays) ?? today

  return {
    name: fromTemplate.name,
    providerHint: fromRoute ?? provider?.id ?? fromTemplate.providerHint,
    cycle: fromTemplate.cycle,
    startsAt: today,
    expiresAt,
    remindDays: [...DEFAULT_REMIND_DAYS],
    notes: [
      fromTemplate.notes,
      fromRoute ? `Matched route: ${fromRoute}` : undefined,
      provider ? `Models provider: ${provider.name}` : undefined,
    ].filter(Boolean).join(' · '),
  }
}

export function templatesForSnapshot(): TimeMasterContextSnapshot['templates'] {
  return PLAN_TEMPLATES.map(template => ({
    name: template.name,
    cycle: template.cycle,
    providerHint: template.providerHint,
    notes: template.notes,
  }))
}
