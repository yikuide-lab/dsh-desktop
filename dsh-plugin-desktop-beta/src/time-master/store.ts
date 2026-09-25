/** Persistence for Time Master plans.json. */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  DEFAULT_REMIND_DAYS,
  isTokenPlanCycle,
  type TimeMasterStoreFile,
  type TokenPlan,
  type TokenPlanDraft,
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
  return { version: 1, plans: [], remindersSent: {} }
}

export function readTimeMasterStore(path: string): TimeMasterStoreFile {
  if (!existsSync(path)) return emptyStore()
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<TimeMasterStoreFile>
    if (raw.version !== 1 || !Array.isArray(raw.plans)) return emptyStore()
    const plans = raw.plans
      .map(normalizePlan)
      .filter((plan): plan is TokenPlan => plan !== null)
    const remindersSent: Record<string, string[]> = {}
    if (raw.remindersSent && typeof raw.remindersSent === 'object') {
      for (const [id, keys] of Object.entries(raw.remindersSent)) {
        if (Array.isArray(keys)) {
          remindersSent[id] = keys.filter(key => typeof key === 'string')
        }
      }
    }
    return { version: 1, plans, remindersSent }
  } catch {
    return emptyStore()
  }
}

export function writeTimeMasterStore(path: string, store: TimeMasterStoreFile): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.${process.pid}.tmp`
  const payload: TimeMasterStoreFile = {
    version: 1,
    plans: store.plans,
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
    remindersSent,
  }
}

export function markRemindersSent(
  store: TimeMasterStoreFile,
  planId: string,
  keys: readonly string[],
): TimeMasterStoreFile {
  const previous = store.remindersSent[planId] ?? []
  const merged = [...new Set([...previous, ...keys])]
  return {
    ...store,
    remindersSent: { ...store.remindersSent, [planId]: merged },
  }
}
