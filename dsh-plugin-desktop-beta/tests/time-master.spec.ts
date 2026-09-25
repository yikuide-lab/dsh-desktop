/**
 * Time Master store, reminder keys, and heuristic draft fill.
 */

import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectDueReminders,
  deletePlan,
  emptyStore,
  heuristicSuggest,
  markRemindersSent,
  planUrgency,
  readTimeMasterStore,
  reminderKey,
  upsertPlan,
  writeTimeMasterStore,
} from '../src/time-master/index.ts'
import type { TimeMasterContextSnapshot } from '../src/time-master/types.ts'

describe('time-master core', () => {
  it('persists plans.json with upsert and delete', () => {
    const dir = mkdtempSync(join(tmpdir(), 'time-master-'))
    const path = join(dir, 'plans.json')
    try {
      let store = emptyStore()
      const created = upsertPlan(store, {
        name: 'Claude Pro',
        cycle: 'monthly',
        expiresAt: '2026-10-01',
        providerHint: 'claude',
      })
      store = created.store
      writeTimeMasterStore(path, store)
      const raw = readFileSync(path, 'utf8')
      expect(raw).toContain('Claude Pro')
      const reloaded = readTimeMasterStore(path)
      expect(reloaded.plans).toHaveLength(1)
      expect(reloaded.plans[0]?.expiresAt).toBe('2026-10-01')
      store = deletePlan(reloaded, created.plan.id)
      writeTimeMasterStore(path, store)
      expect(readTimeMasterStore(path).plans).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('computes reminder keys and due reminders without duplicates', () => {
    const plan = upsertPlan(emptyStore(), {
      name: 'Codex Plus',
      expiresAt: '2026-09-28',
      remindDays: [7, 3, 1, 0],
    }).plan
    expect(reminderKey(plan.expiresAt, 3)).toBe('2026-09-28|d3')
    const due = collectDueReminders({
      plans: [plan],
      remindersSent: {},
      today: '2026-09-25',
      locale: 'zh',
    })
    expect(due).toHaveLength(1)
    expect(due[0]?.day).toBe(3)
    expect(due[0]?.body).toContain('Codex Plus')
    const marked = markRemindersSent(emptyStore(), plan.id, [due[0]!.key])
    const again = collectDueReminders({
      plans: [plan],
      remindersSent: marked.remindersSent,
      today: '2026-09-25',
    })
    expect(again).toHaveLength(0)
  })

  it('classifies urgency and heuristic drafts', () => {
    const plan = upsertPlan(emptyStore(), {
      name: 'Cursor Pro',
      expiresAt: '2026-09-26',
    }).plan
    expect(planUrgency(plan, '2026-09-25')).toBe('soon')
    expect(planUrgency(plan, '2026-09-27')).toBe('expired')
    expect(planUrgency({ ...plan, expiresAt: '2026-12-01' }, '2026-09-25')).toBe('ok')

    const context: TimeMasterContextSnapshot = {
      providers: [{ id: 'claude', name: 'Claude', models: ['claude-opus'] }],
      tokenPlanRoutes: ['qwen-token-plan'],
      workflowProviders: [],
      templates: [],
      today: '2026-09-25',
    }
    const draft = heuristicSuggest({ context, hint: 'claude' })
    expect(draft.name).toMatch(/Claude/i)
    expect(draft.expiresAt).toBeTruthy()
    expect(draft.cycle).toBe('monthly')
  })
})
