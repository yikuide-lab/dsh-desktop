/** Reminder-key computation for Time Master expiry notifications (V2). */

import { daysBetween, localDateString } from './dates.js'
import type { ProjectPlan, TokenPlan, UsageSchedule } from './types.js'
import { DEFAULT_TASK_REMIND_DAYS } from './types.js'
import { taskReminderEntityId } from './store.js'

/** Stable key for one plan (expiresAt, dayOffset) reminder firing. */
export function planReminderKey(expiresAt: string, day: number): string {
  return `plan:${expiresAt}|d${day}`
}

/** Stable key for one task (dueAt, dayOffset) reminder firing. */
export function taskReminderKey(taskId: string, dueAt: string, day: number): string {
  return `task:${taskId}|${dueAt}|d${day}`
}

/** Stable key for one schedule window-end reminder. */
export function scheduleReminderKey(scheduleId: string, windowEnd: string, day: number): string {
  return `schedule:${scheduleId}|${windowEnd}|d${day}`
}

/** @deprecated Use planReminderKey — kept for test compatibility. */
export function reminderKey(expiresAt: string, day: number): string {
  return planReminderKey(expiresAt, day)
}

export interface DueReminder {
  readonly kind: 'plan' | 'task' | 'schedule'
  readonly entityId: string
  readonly plan?: TokenPlan
  readonly projectId?: string
  readonly taskId?: string
  readonly scheduleId?: string
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
  projects?: readonly ProjectPlan[]
  schedules?: readonly UsageSchedule[]
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
      const key = planReminderKey(plan.expiresAt, day)
      if (sent.has(key)) continue
      out.push({
        kind: 'plan',
        entityId: plan.id,
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

  for (const project of input.projects ?? []) {
    if (project.status === 'done') continue
    for (const task of project.tasks) {
      if (!task.dueAt || task.status === 'done') continue
      const entityId = taskReminderEntityId(project.id, task.id)
      const sent = new Set(input.remindersSent[entityId] ?? [])
      const remaining = daysBetween(today, task.dueAt)
      if (remaining === null) continue
      const remindDays = task.remindDays ?? DEFAULT_TASK_REMIND_DAYS
      for (const day of remindDays) {
        if (remaining !== day) continue
        const key = taskReminderKey(task.id, task.dueAt, day)
        if (sent.has(key)) continue
        out.push({
          kind: 'task',
          entityId,
          projectId: project.id,
          taskId: task.id,
          day,
          key,
          title: locale === 'zh' ? '时间大师 · 任务提醒' : 'Time Master · task reminder',
          body: locale === 'zh'
            ? (day === 0
              ? `「${project.title}」任务「${task.title}」今日到期`
              : `「${project.title}」任务「${task.title}」将在 ${day} 天后到期（${task.dueAt}）`)
            : (day === 0
              ? `Task "${task.title}" in "${project.title}" is due today`
              : `Task "${task.title}" in "${project.title}" is due in ${day} day(s) (${task.dueAt})`),
        })
      }
    }
  }

  for (const schedule of input.schedules ?? []) {
    const sent = new Set(input.remindersSent[schedule.id] ?? [])
    for (const item of schedule.items) {
      const remaining = daysBetween(today, item.windowEnd)
      if (remaining === null) continue
      if (remaining !== 0 && remaining !== 1) continue
      const key = scheduleReminderKey(schedule.id, item.windowEnd, remaining)
      if (sent.has(key)) continue
      out.push({
        kind: 'schedule',
        entityId: schedule.id,
        scheduleId: schedule.id,
        day: remaining,
        key,
        title: locale === 'zh' ? '时间大师 · 编排窗口' : 'Time Master · schedule window',
        body: locale === 'zh'
          ? `编排「${schedule.name}」窗口 ${item.windowStart}–${item.windowEnd} ${remaining === 0 ? '今日结束' : '明日结束'}`
          : `Schedule "${schedule.name}" window ${item.windowStart}–${item.windowEnd} ends ${remaining === 0 ? 'today' : 'tomorrow'}`,
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

/** Urgency class for project tasks. */
export function taskUrgency(
  dueAt: string | undefined,
  today: string = localDateString(),
): 'expired' | 'soon' | 'ok' | 'none' {
  if (!dueAt) return 'none'
  const remaining = daysBetween(today, dueAt)
  if (remaining === null) return 'none'
  if (remaining < 0) return 'expired'
  if (remaining <= 3) return 'soon'
  return 'ok'
}
