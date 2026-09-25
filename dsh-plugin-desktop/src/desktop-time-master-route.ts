/** Strict loopback HTTP handler for Time Master. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import {
  DESKTOP_TIME_MASTER_PATH,
  type DesktopTimeMasterOp,
  type DesktopTimeMasterRequest,
} from './desktop-time-master-contract.ts'
import {
  buildContextSnapshot,
  deletePlan,
  planUrgency,
  readTimeMasterStore,
  resolveTimeMasterStorePath,
  suggestTokenPlan,
  upsertPlan,
  writeTimeMasterStore,
  localDateString,
} from './time-master/index.ts'

const MAX_BODY_BYTES = 256 * 1024
const OPS = new Set<DesktopTimeMasterOp>([
  'list', 'upsert', 'delete', 'contextSnapshot', 'aiSuggest',
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
      plans: store.plans.map(plan => ({
        ...plan,
        urgency: planUrgency(plan, today),
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
