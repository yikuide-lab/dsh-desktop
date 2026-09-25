/** Reminder-key computation for Time Master expiry notifications. */

import { daysBetween, localDateString } from './dates.js'
import type { TokenPlan } from './types.js'

/** Stable key for one (plan, expiresAt, dayOffset) reminder firing. */
export function reminderKey(expiresAt: string, day: number): string {
  return `${expiresAt}|d${day}`
}

export interface DueReminder {
  readonly plan: TokenPlan
  readonly day: number
  readonly key: string
  readonly title: string
  readonly body: string
}

/**
 * List reminders that should fire for `today` given already-sent keys.
 * Does not mutate store; caller marks keys after successful notify.
 */
export function collectDueReminders(input: {
  plans: readonly TokenPlan[]
  remindersSent: Record<string, string[]>
  today?: string
  locale?: 'zh' | 'en'
}): DueReminder[] {
  const today = input.today ?? localDateString()
  const locale = input.locale ?? 'zh'
  const out: DueReminder[] = []

  for (const plan of input.plans) {
    const sent = new Set(input.remindersSent[plan.id] ?? [])
    const remaining = daysBetween(today, plan.expiresAt)
    if (remaining === null) continue
    for (const day of plan.remindDays) {
      if (remaining !== day) continue
      const key = reminderKey(plan.expiresAt, day)
      if (sent.has(key)) continue
      out.push({
        plan,
        day,
        key,
        title: locale === 'zh' ? '时间大师 · 套餐提醒' : 'Time Master · plan reminder',
        body: locale === 'zh'
          ? (day === 0
            ? `「${plan.name}」今日到期`
            : `「${plan.name}」将在 ${day} 天后到期（${plan.expiresAt}）`)
          : (day === 0
            ? `"${plan.name}" expires today`
            : `"${plan.name}" expires in ${day} day(s) (${plan.expiresAt})`),
      })
    }
  }
  return out
}

/** Urgency class for UI highlighting. */
export function planUrgency(
  plan: TokenPlan,
  today: string = localDateString(),
): 'expired' | 'soon' | 'ok' {
  const remaining = daysBetween(today, plan.expiresAt)
  if (remaining === null) return 'ok'
  if (remaining < 0) return 'expired'
  if (remaining <= 3) return 'soon'
  return 'ok'
}
