/** Persistence for Time Master plans.json (V2). */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  DEFAULT_REMIND_DAYS,
  DEFAULT_TASK_REMIND_DAYS,
  isProjectPlanStatus,
  isProjectTaskStatus,
  isTokenPlanCycle,
  isUsageScheduleRole,
  type ProjectPlan,
  type ProjectPlanDraft,
  type ProjectTask,
  type ProjectTaskDraft,
  type TimeMasterStoreFile,
  type TokenPlan,
  type TokenPlanDraft,
  type UsageSchedule,
  type UsageScheduleDraft,
} from './types.js'
import { localDateString } from './dates.js'

export function resolveTimeMasterDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const dshHome = env.DSH_HOME?.trim() || join(home, '.dsh')
  return join(dshHome, 'time-master')
}

export function resolveTimeMasterStorePath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  return join(resolveTimeMasterDir(env, home), 'plans.json')
}

export function emptyStore(): TimeMasterStoreFile {
  return { version: 2, plans: [], schedules: [], projects: [], remindersSent: {} }
}

function migrateReminderKey(key: string): string {
  if (key.startsWith('plan:') || key.startsWith('task:') || key.startsWith('schedule:')) {
    return key
  }
  return `plan:${key}`
}

function normalizeRemindersSent(raw: unknown): Record<string, string[]> {
  const remindersSent: Record<string, string[]> = {}
  if (!raw || typeof raw !== 'object') return remindersSent
  for (const [id, keys] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(keys)) {
      remindersSent[id] = keys
        .filter(key => typeof key === 'string')
        .map(migrateReminderKey)
    }
  }
  return remindersSent
}

export function readTimeMasterStore(path: string): TimeMasterStoreFile {
  if (!existsSync(path)) return emptyStore()
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<TimeMasterStoreFile> & { version?: number }
    if (raw.version !== 1 && raw.version !== 2) return emptyStore()
    const plans = (Array.isArray(raw.plans) ? raw.plans : [])
      .map(normalizePlan)
      .filter((plan): plan is TokenPlan => plan !== null)
    const schedules = raw.version === 2 && Array.isArray(raw.schedules)
      ? raw.schedules.map(normalizeSchedule).filter((s): s is UsageSchedule => s !== null)
      : []
    const projects = raw.version === 2 && Array.isArray(raw.projects)
      ? raw.projects.map(normalizeProject).filter((p): p is ProjectPlan => p !== null)
      : []
    return {
      version: 2,
      plans,
      schedules,
      projects,
      remindersSent: normalizeRemindersSent(raw.remindersSent),
    }
  } catch {
    return emptyStore()
  }
}

export function writeTimeMasterStore(path: string, store: TimeMasterStoreFile): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.${process.pid}.tmp`
  const payload: TimeMasterStoreFile = {
    version: 2,
    plans: store.plans,
    schedules: store.schedules,
    projects: store.projects,
    remindersSent: store.remindersSent,
  }
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, path)
}

function normalizePlan(value: unknown): TokenPlan | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const id = typeof row.id === 'string' ? row.id : null
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  const expiresAt = typeof row.expiresAt === 'string' ? row.expiresAt.trim() : ''
  if (!id || !name || !expiresAt) return null
  const cycle = isTokenPlanCycle(row.cycle) ? row.cycle : 'monthly'
  const remindDays = Array.isArray(row.remindDays)
    ? row.remindDays.filter((day): day is number => typeof day === 'number' && Number.isFinite(day) && day >= 0)
    : [...DEFAULT_REMIND_DAYS]
  const now = new Date().toISOString()
  return {
    id,
    name,
    ...(typeof row.providerHint === 'string' && row.providerHint.trim()
      ? { providerHint: row.providerHint.trim() }
      : {}),
    cycle,
    ...(typeof row.startsAt === 'string' && row.startsAt.trim()
      ? { startsAt: row.startsAt.trim() }
      : {}),
    expiresAt,
    remindDays: remindDays.length > 0 ? remindDays : [...DEFAULT_REMIND_DAYS],
    ...(typeof row.notes === 'string' && row.notes.trim()
      ? { notes: row.notes.trim() }
      : {}),
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : now,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : now,
  }
}

function normalizeScheduleItem(value: unknown): UsageSchedule['items'][number] | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const planId = typeof row.planId === 'string' ? row.planId.trim() : ''
  const windowStart = typeof row.windowStart === 'string' ? row.windowStart.trim() : ''
  const windowEnd = typeof row.windowEnd === 'string' ? row.windowEnd.trim() : ''
  const role = isUsageScheduleRole(row.role) ? row.role : 'primary'
  if (!planId || !windowStart || !windowEnd) return null
  return {
    planId,
    role,
    windowStart,
    windowEnd,
    ...(typeof row.dailyBudgetHint === 'string' && row.dailyBudgetHint.trim()
      ? { dailyBudgetHint: row.dailyBudgetHint.trim() }
      : {}),
    ...(typeof row.notes === 'string' && row.notes.trim()
      ? { notes: row.notes.trim() }
      : {}),
  }
}

function normalizeSchedule(value: unknown): UsageSchedule | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const id = typeof row.id === 'string' ? row.id : null
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  if (!id || !name) return null
  const items = Array.isArray(row.items)
    ? row.items.map(normalizeScheduleItem).filter((item): item is UsageSchedule['items'][number] => item !== null)
    : []
  const now = new Date().toISOString()
  return {
    id,
    name,
    horizonDays: typeof row.horizonDays === 'number' && row.horizonDays > 0 ? row.horizonDays : 30,
    items,
    ...(typeof row.rationale === 'string' && row.rationale.trim()
      ? { rationale: row.rationale.trim() }
      : {}),
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : now,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : now,
  }
}

function normalizeTask(value: unknown): ProjectTask | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const id = typeof row.id === 'string' ? row.id : null
  const title = typeof row.title === 'string' ? row.title.trim() : ''
  if (!id || !title) return null
  const status = isProjectTaskStatus(row.status) ? row.status : 'todo'
  const remindDays = Array.isArray(row.remindDays)
    ? row.remindDays.filter((day): day is number => typeof day === 'number' && day >= 0)
    : undefined
  return {
    id,
    title,
    status,
    ...(typeof row.dueAt === 'string' && row.dueAt.trim() ? { dueAt: row.dueAt.trim() } : {}),
    ...(remindDays && remindDays.length > 0 ? { remindDays } : {}),
    ...(typeof row.estimateHours === 'number' && row.estimateHours > 0
      ? { estimateHours: row.estimateHours }
      : {}),
    ...(Array.isArray(row.dependsOn)
      ? { dependsOn: row.dependsOn.filter((dep): dep is string => typeof dep === 'string') }
      : {}),
    ...(typeof row.sessionId === 'string' && row.sessionId.trim()
      ? { sessionId: row.sessionId.trim() }
      : {}),
    ...(typeof row.workflowName === 'string' && row.workflowName.trim()
      ? { workflowName: row.workflowName.trim() }
      : {}),
    ...(typeof row.loopId === 'string' && row.loopId.trim()
      ? { loopId: row.loopId.trim() }
      : {}),
    ...(typeof row.planId === 'string' && row.planId.trim()
      ? { planId: row.planId.trim() }
      : {}),
    ...(typeof row.notes === 'string' && row.notes.trim()
      ? { notes: row.notes.trim() }
      : {}),
  }
}

function normalizeProject(value: unknown): ProjectPlan | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const id = typeof row.id === 'string' ? row.id : null
  const title = typeof row.title === 'string' ? row.title.trim() : ''
  const goal = typeof row.goal === 'string' ? row.goal.trim() : ''
  if (!id || !title) return null
  const status = isProjectPlanStatus(row.status) ? row.status : 'active'
  const tasks = Array.isArray(row.tasks)
    ? row.tasks.map(normalizeTask).filter((task): task is ProjectTask => task !== null)
    : []
  const now = new Date().toISOString()
  return {
    id,
    title,
    goal,
    status,
    tasks,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : now,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : now,
  }
}

function normalizeTaskDraft(draft: ProjectTaskDraft): ProjectTask {
  const title = draft.title?.trim() ?? 'Untitled task'
  return {
    id: draft.id ?? `task-${randomUUID()}`,
    title,
    status: draft.status && isProjectTaskStatus(draft.status) ? draft.status : 'todo',
    ...(draft.dueAt?.trim() ? { dueAt: draft.dueAt.trim() } : {}),
    remindDays: draft.remindDays && draft.remindDays.length > 0
      ? [...draft.remindDays]
      : [...DEFAULT_TASK_REMIND_DAYS],
    ...(typeof draft.estimateHours === 'number' && draft.estimateHours > 0
      ? { estimateHours: draft.estimateHours }
      : {}),
    ...(draft.dependsOn && draft.dependsOn.length > 0 ? { dependsOn: [...draft.dependsOn] } : {}),
    ...(draft.sessionId?.trim() ? { sessionId: draft.sessionId.trim() } : {}),
    ...(draft.workflowName?.trim() ? { workflowName: draft.workflowName.trim() } : {}),
    ...(draft.loopId?.trim() ? { loopId: draft.loopId.trim() } : {}),
    ...(draft.planId?.trim() ? { planId: draft.planId.trim() } : {}),
    ...(draft.notes?.trim() ? { notes: draft.notes.trim() } : {}),
  }
}

/** Create or replace one plan from a draft. */
export function upsertPlan(
  store: TimeMasterStoreFile,
  draft: TokenPlanDraft & { id?: string },
): { store: TimeMasterStoreFile; plan: TokenPlan } {
  const name = draft.name?.trim()
  const expiresAt = draft.expiresAt?.trim()
  if (!name) throw new Error('name is required')
  if (!expiresAt) throw new Error('expiresAt is required')

  const now = new Date().toISOString()
  const existing = draft.id ? store.plans.find(plan => plan.id === draft.id) : undefined
  const plan: TokenPlan = {
    id: existing?.id ?? draft.id ?? `plan-${randomUUID()}`,
    name,
    ...(draft.providerHint?.trim() ? { providerHint: draft.providerHint.trim() } : {}),
    cycle: draft.cycle && isTokenPlanCycle(draft.cycle) ? draft.cycle : (existing?.cycle ?? 'monthly'),
    ...(draft.startsAt?.trim()
      ? { startsAt: draft.startsAt.trim() }
      : existing?.startsAt
        ? { startsAt: existing.startsAt }
        : { startsAt: localDateString() }),
    expiresAt,
    remindDays: draft.remindDays && draft.remindDays.length > 0
      ? [...draft.remindDays]
      : existing
        ? [...existing.remindDays]
        : [...DEFAULT_REMIND_DAYS],
    ...(draft.notes?.trim()
      ? { notes: draft.notes.trim() }
      : existing?.notes
        ? { notes: existing.notes }
        : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }

  const plans = existing
    ? store.plans.map(entry => (entry.id === plan.id ? plan : entry))
    : [...store.plans, plan]
  return { store: { ...store, plans }, plan }
}

export function deletePlan(store: TimeMasterStoreFile, id: string): TimeMasterStoreFile {
  const remindersSent = { ...store.remindersSent }
  delete remindersSent[id]
  return {
    ...store,
    plans: store.plans.filter(plan => plan.id !== id),
    schedules: store.schedules.map(schedule => ({
      ...schedule,
      items: schedule.items.filter(item => item.planId !== id),
    })),
    remindersSent,
  }
}

export function upsertSchedule(
  store: TimeMasterStoreFile,
  draft: UsageScheduleDraft,
): { store: TimeMasterStoreFile; schedule: UsageSchedule } {
  const name = draft.name?.trim()
  if (!name) throw new Error('name is required')

  const now = new Date().toISOString()
  const existing = draft.id ? store.schedules.find(s => s.id === draft.id) : undefined
  const items = draft.items
    ? draft.items.map(item => normalizeScheduleItem(item)).filter((item): item is UsageSchedule['items'][number] => item !== null)
    : existing?.items ?? []

  const schedule: UsageSchedule = {
    id: existing?.id ?? draft.id ?? `schedule-${randomUUID()}`,
    name,
    horizonDays: draft.horizonDays && draft.horizonDays > 0 ? draft.horizonDays : (existing?.horizonDays ?? 30),
    items,
    ...(draft.rationale?.trim()
      ? { rationale: draft.rationale.trim() }
      : existing?.rationale
        ? { rationale: existing.rationale }
        : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }

  const schedules = existing
    ? store.schedules.map(entry => (entry.id === schedule.id ? schedule : entry))
    : [...store.schedules, schedule]
  return { store: { ...store, schedules }, schedule }
}

export function deleteSchedule(store: TimeMasterStoreFile, id: string): TimeMasterStoreFile {
  const remindersSent = { ...store.remindersSent }
  delete remindersSent[id]
  return {
    ...store,
    schedules: store.schedules.filter(schedule => schedule.id !== id),
    remindersSent,
  }
}

export function upsertProject(
  store: TimeMasterStoreFile,
  draft: ProjectPlanDraft,
): { store: TimeMasterStoreFile; project: ProjectPlan } {
  const title = draft.title?.trim()
  const goal = draft.goal?.trim()
  if (!title) throw new Error('title is required')
  if (!goal) throw new Error('goal is required')

  const now = new Date().toISOString()
  const existing = draft.id ? store.projects.find(p => p.id === draft.id) : undefined
  const tasks = draft.tasks
    ? draft.tasks.map((task, index) => {
      const existingTask = task.id
        ? existing?.tasks.find(t => t.id === task.id)
        : undefined
      const normalized = normalizeTaskDraft({
        ...task,
        id: existingTask?.id ?? task.id,
      })
      return normalized
    })
    : existing?.tasks ?? []

  const project: ProjectPlan = {
    id: existing?.id ?? draft.id ?? `project-${randomUUID()}`,
    title,
    goal,
    status: draft.status && isProjectPlanStatus(draft.status) ? draft.status : (existing?.status ?? 'active'),
    tasks,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }

  const projects = existing
    ? store.projects.map(entry => (entry.id === project.id ? project : entry))
    : [...store.projects, project]
  return { store: { ...store, projects }, project }
}

export function deleteProject(store: TimeMasterStoreFile, id: string): TimeMasterStoreFile {
  const remindersSent = { ...store.remindersSent }
  for (const key of Object.keys(remindersSent)) {
    if (key.startsWith(`${id}:`) || key === id) delete remindersSent[key]
  }
  return {
    ...store,
    projects: store.projects.filter(project => project.id !== id),
    remindersSent,
  }
}

export function markRemindersSent(
  store: TimeMasterStoreFile,
  entityId: string,
  keys: readonly string[],
): TimeMasterStoreFile {
  const previous = store.remindersSent[entityId] ?? []
  const merged = [...new Set([...previous, ...keys])]
  return {
    ...store,
    remindersSent: { ...store.remindersSent, [entityId]: merged },
  }
}

/** Reminder entity key for a project task. */
export function taskReminderEntityId(projectId: string, taskId: string): string {
  return `${projectId}:${taskId}`
}
