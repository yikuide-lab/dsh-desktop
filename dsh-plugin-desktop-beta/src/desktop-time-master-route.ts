/** Strict loopback HTTP handler for Time Master. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import {
  DESKTOP_TIME_MASTER_PATH,
  type DesktopTimeMasterOp,
  type DesktopTimeMasterRequest,
} from './desktop-time-master-contract.ts'
import {
  applyCoordSuggestions,
  buildContextSnapshot,
  buildCoordSnapshot,
  coordinateTasks,
  deletePlan,
  deleteProject,
  deleteSchedule,
  orchestrateUsage,
  planProject,
  planUrgency,
  readTimeMasterStore,
  resolveTimeMasterStorePath,
  suggestTokenPlan,
  taskUrgency,
  upsertPlan,
  upsertProject,
  upsertSchedule,
  writeTimeMasterStore,
  localDateString,
} from './time-master/index.ts'

const MAX_BODY_BYTES = 256 * 1024
const OPS = new Set<DesktopTimeMasterOp>([
  'list', 'upsert', 'delete', 'contextSnapshot', 'aiSuggest',
  'schedule.list', 'schedule.upsert', 'schedule.delete', 'aiOrchestrateUsage',
  'project.list', 'project.upsert', 'project.delete', 'aiPlanProject',
  'coord.snapshot', 'aiCoordinate',
])

class BodyTooLargeError extends Error {}

function finishJson(res: ServerResponse, statusCode: number, value: object, allow?: 'POST'): void {
  res.statusCode = statusCode
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  if (allow) res.setHeader('allow', allow)
  res.end(JSON.stringify(value))
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > MAX_BODY_BYTES) throw new BodyTooLargeError()
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function executeOp(ctx: Context, body: DesktopTimeMasterRequest): Promise<object> {
  const path = resolveTimeMasterStorePath()

  if (body.op === 'list') {
    const store = readTimeMasterStore(path)
    const today = localDateString()
    return {
      ok: true,
      today,
      version: store.version,
      plans: store.plans.map(plan => ({
        ...plan,
        urgency: planUrgency(plan, today),
      })),
      schedules: store.schedules,
      projects: store.projects.map(project => ({
        ...project,
        tasks: project.tasks.map(task => ({
          ...task,
          urgency: taskUrgency(task.dueAt, today),
        })),
      })),
    }
  }

  if (body.op === 'upsert') {
    if (!body.draft) return { ok: false, error: 'draft is required' }
    const store = readTimeMasterStore(path)
    try {
      const { store: next, plan } = upsertPlan(store, body.draft)
      writeTimeMasterStore(path, next)
      return { ok: true, plan, urgency: planUrgency(plan) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'upsert failed' }
    }
  }

  if (body.op === 'delete') {
    if (!body.id) return { ok: false, error: 'id is required' }
    const store = readTimeMasterStore(path)
    writeTimeMasterStore(path, deletePlan(store, body.id))
    return { ok: true }
  }

  if (body.op === 'schedule.list') {
    const store = readTimeMasterStore(path)
    return { ok: true, schedules: store.schedules }
  }

  if (body.op === 'schedule.upsert') {
    if (!body.scheduleDraft) return { ok: false, error: 'scheduleDraft is required' }
    const store = readTimeMasterStore(path)
    try {
      const { store: next, schedule } = upsertSchedule(store, body.scheduleDraft)
      writeTimeMasterStore(path, next)
      return { ok: true, schedule }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'schedule upsert failed' }
    }
  }

  if (body.op === 'schedule.delete') {
    if (!body.id) return { ok: false, error: 'id is required' }
    const store = readTimeMasterStore(path)
    writeTimeMasterStore(path, deleteSchedule(store, body.id))
    return { ok: true }
  }

  if (body.op === 'project.list') {
    const store = readTimeMasterStore(path)
    const today = localDateString()
    return {
      ok: true,
      projects: store.projects.map(project => ({
        ...project,
        tasks: project.tasks.map(task => ({
          ...task,
          urgency: taskUrgency(task.dueAt, today),
        })),
      })),
    }
  }

  if (body.op === 'project.upsert') {
    if (!body.projectDraft) return { ok: false, error: 'projectDraft is required' }
    const store = readTimeMasterStore(path)
    try {
      const { store: next, project } = upsertProject(store, body.projectDraft)
      writeTimeMasterStore(path, next)
      return { ok: true, project }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'project upsert failed' }
    }
  }

  if (body.op === 'project.delete') {
    if (!body.id) return { ok: false, error: 'id is required' }
    const store = readTimeMasterStore(path)
    writeTimeMasterStore(path, deleteProject(store, body.id))
    return { ok: true }
  }

  if (body.op === 'contextSnapshot') {
    const context = await buildContextSnapshot(ctx)
    return { ok: true, context }
  }

  if (body.op === 'aiSuggest') {
    const context = await buildContextSnapshot(ctx)
    const result = await suggestTokenPlan({
      ctx,
      context,
      ...(body.hint ? { hint: body.hint } : {}),
    })
    return { ok: true, draft: result.draft, source: result.source, context }
  }

  if (body.op === 'aiOrchestrateUsage') {
    const store = readTimeMasterStore(path)
    const context = await buildContextSnapshot(ctx)
    const result = await orchestrateUsage({
      ctx,
      plans: store.plans,
      context,
      ...(body.hint ? { hint: body.hint } : {}),
    })
    return { ok: true, draft: result.draft, source: result.source, context }
  }

  if (body.op === 'aiPlanProject') {
    const context = await buildContextSnapshot(ctx)
    const result = await planProject({
      ctx,
      context,
      ...(body.hint ? { hint: body.hint } : {}),
    })
    return { ok: true, draft: result.draft, source: result.source, context }
  }

  if (body.op === 'coord.snapshot') {
    const store = readTimeMasterStore(path)
    const snapshot = buildCoordSnapshot({
      projects: store.projects,
      schedules: store.schedules,
      plans: store.plans,
    })
    return { ok: true, snapshot }
  }

  if (body.op === 'aiCoordinate') {
    const store = readTimeMasterStore(path)
    const snapshot = buildCoordSnapshot({
      projects: store.projects,
      schedules: store.schedules,
      plans: store.plans,
    })
    const result = await coordinateTasks({
      ctx,
      snapshot,
      projects: store.projects,
    })

    if (body.applySuggestions && result.suggestions.length > 0) {
      let next = store
      for (const project of store.projects) {
        const updated = applyCoordSuggestions(project, result.suggestions)
        if (updated !== project) {
          const upserted = upsertProject(next, updated)
          next = upserted.store
        }
      }
      writeTimeMasterStore(path, next)
      const refreshed = buildCoordSnapshot({
        projects: next.projects,
        schedules: next.schedules,
        plans: next.plans,
      })
      return {
        ok: true,
        suggestions: result.suggestions,
        source: result.source,
        snapshot: refreshed,
        applied: true,
      }
    }

    return {
      ok: true,
      suggestions: result.suggestions,
      source: result.source,
      snapshot,
      applied: false,
    }
  }

  return { ok: false, error: 'unknown op' }
}

/** Handle POST /api/desktop/time-master. */
export async function handleDesktopTimeMasterRequest(
  req: IncomingMessage,
  res: ServerResponse,
  rendererOrigin: string,
  ctx: Context,
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.setHeader('access-control-allow-origin', rendererOrigin)
    res.setHeader('access-control-allow-methods', 'POST, OPTIONS')
    res.setHeader('access-control-allow-headers', 'content-type')
    res.end()
    return
  }
  if (req.method !== 'POST') {
    finishJson(res, 405, { ok: false, error: 'method not allowed' }, 'POST')
    return
  }
  const urlPath = req.url?.split('?')[0]
  if (urlPath !== DESKTOP_TIME_MASTER_PATH) {
    finishJson(res, 404, { ok: false, error: 'not found' })
    return
  }

  let raw: string
  try {
    raw = await readBody(req)
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      finishJson(res, 413, { ok: false, error: 'body too large' })
      return
    }
    finishJson(res, 400, { ok: false, error: 'failed to read body' })
    return
  }

  let body: DesktopTimeMasterRequest
  try {
    body = JSON.parse(raw) as DesktopTimeMasterRequest
  } catch {
    finishJson(res, 400, { ok: false, error: 'invalid json' })
    return
  }
  if (!body || typeof body.op !== 'string' || !OPS.has(body.op)) {
    finishJson(res, 400, { ok: false, error: 'invalid op' })
    return
  }

  try {
    const result = await executeOp(ctx, body)
    const ok = (result as { ok?: boolean }).ok !== false
    finishJson(res, ok ? 200 : 400, result)
  } catch (error) {
    finishJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'time-master failed',
    })
  }
}

export { DESKTOP_TIME_MASTER_PATH }
