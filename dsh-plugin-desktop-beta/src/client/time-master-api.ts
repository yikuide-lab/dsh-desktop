/** Same-origin browser client for Desktop Time Master. */

import type { TokenPlan, TokenPlanCycle, TokenPlanDraft, TimeMasterContextSnapshot } from '../time-master/types.js'

const TIME_MASTER_PATH = '/api/desktop/time-master'

export type PlanUrgency = 'expired' | 'soon' | 'ok'

export interface TimeMasterPlanView extends TokenPlan {
  readonly urgency: PlanUrgency
}

export interface DesktopTimeMasterApi {
  list(): Promise<{ today: string; plans: TimeMasterPlanView[] }>
  upsert(draft: TokenPlanDraft & { id?: string }): Promise<{ plan: TokenPlan; urgency: PlanUrgency }>
  delete(id: string): Promise<void>
  contextSnapshot(): Promise<TimeMasterContextSnapshot>
  aiSuggest(hint?: string): Promise<{ draft: TokenPlanDraft; source: 'ai' | 'heuristic' }>
}

async function call<T>(
  body: object,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<T> {
  const response = await fetcher(TIME_MASTER_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await response.json() as { ok?: boolean; error?: string } & T
  if (!response.ok || json.ok === false) {
    throw new Error(json.error ?? `time-master failed (${response.status})`)
  }
  return json
}

export function createDesktopTimeMasterApi(
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): DesktopTimeMasterApi {
  return {
    async list() {
      const result = await call<{ today: string; plans: TimeMasterPlanView[] }>({ op: 'list' }, fetcher)
      return { today: result.today, plans: result.plans ?? [] }
    },
    async upsert(draft) {
      const result = await call<{ plan: TokenPlan; urgency: PlanUrgency }>({ op: 'upsert', draft }, fetcher)
      return { plan: result.plan, urgency: result.urgency }
    },
    async delete(id) {
      await call({ op: 'delete', id }, fetcher)
    },
    async contextSnapshot() {
      const result = await call<{ context: TimeMasterContextSnapshot }>({ op: 'contextSnapshot' }, fetcher)
      return result.context
    },
    async aiSuggest(hint) {
      const result = await call<{ draft: TokenPlanDraft; source: 'ai' | 'heuristic' }>({
        op: 'aiSuggest',
        ...(hint?.trim() ? { hint: hint.trim() } : {}),
      }, fetcher)
      return { draft: result.draft, source: result.source }
    },
  }
}

export type { TokenPlanCycle }
export { TIME_MASTER_PATH }
