/** Strict loopback HTTP handler for Desktop Collab Loop. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import {
  DESKTOP_COLLAB_PATH,
  type DesktopCollabOp,
  type DesktopCollabRequest,
} from './desktop-collab-contract.ts'
import { executeCollabOp } from './collab-host/index.ts'

const MAX_BODY_BYTES = 512 * 1024

const OPS = new Set<DesktopCollabOp>([
  'loop.start',
  'loop.close',
  'loop.get',
  'vision.get',
  'vision.append',
  'roster.get',
  'membership.join',
  'membership.leave',
  'membership.heartbeat',
  'membership.rejoin',
  'membership.invite',
  'membership.kick',
  'network.snapshot',
  'goals.reassign',
  'peer.pause',
  'peer.resume',
  'admin.transfer',
  'healer.evaluate',
  'healer.apply',
  'healer.pending',
  'plan.evaluate',
  'plan.assign',
  'plan.spawnBranch',
  'plan.get',
  'bus.send',
  'grants.issue',
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

/** Handle POST /api/desktop/collab. */
export async function handleDesktopCollabRequest(
  req: IncomingMessage,
  res: ServerResponse,
  rendererOrigin: string,
  ctx?: Context,
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
  if (urlPath !== DESKTOP_COLLAB_PATH) {
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

  let body: DesktopCollabRequest
  try {
    body = JSON.parse(raw) as DesktopCollabRequest
  } catch {
    finishJson(res, 400, { ok: false, error: 'invalid json' })
    return
  }
  if (!body || typeof body.op !== 'string' || !OPS.has(body.op)) {
    finishJson(res, 400, { ok: false, error: 'invalid op' })
    return
  }

  try {
    const result = await executeCollabOp(body, ctx)
    const ok = (result as { ok?: boolean }).ok !== false
    const status = !ok && (result as { error?: string }).error?.startsWith('forbidden')
      ? 403
      : (ok ? 200 : 400)
    finishJson(res, status, result)
  } catch (error) {
    finishJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'collab failed',
    })
  }
}

export { DESKTOP_COLLAB_PATH }
