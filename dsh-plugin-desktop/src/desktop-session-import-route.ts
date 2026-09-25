/** Strict loopback HTTP handler for harness session import. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'
import {
  DESKTOP_SESSION_IMPORT_PATH,
  type DesktopSessionImportErrorResponse,
  type DesktopSessionImportOp,
  type DesktopSessionImportRequest,
} from './desktop-session-import-contract.ts'
import {
  buildSeedEvents,
  convertExternalSession,
  listExternalSessions,
  searchExternalSessions,
} from './session-import/index.ts'

const MAX_BODY_BYTES = 256 * 1024
const OPS = new Set<DesktopSessionImportOp>(['list', 'search', 'import'])

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

function looksLikeAbsolutePath(cwd: string | undefined): cwd is string {
  if (!cwd) return false
  return cwd.startsWith('/') || /^[A-Za-z]:[\\/]/.test(cwd)
}

function executeOp(ctx: Context, body: DesktopSessionImportRequest): object {
  if (body.op === 'list') {
    return { ok: true, items: listExternalSessions(body.sources) }
  }
  if (body.op === 'search') {
    return {
      ok: true,
      items: searchExternalSessions({
        query: body.query ?? '',
        sources: body.sources,
        content: body.content === true,
      }),
    }
  }
  if (body.op === 'import') {
    if (!body.source || !body.sourcePath || !body.id) {
      return { ok: false, error: 'import requires source, id, and sourcePath' } satisfies DesktopSessionImportErrorResponse
    }
    const sessions = ctx.get('sessions') as
      | { create: (id: SessionId, options: object) => { id: SessionId; append: (type: string, data: object) => void } }
      | undefined
    if (!sessions) {
      return { ok: false, error: 'Host sessions service unavailable' } satisfies DesktopSessionImportErrorResponse
    }

    const converted = convertExternalSession({
      source: body.source,
      sourcePath: body.sourcePath,
      id: body.id,
    })
    if (converted.turns.length === 0) {
      return {
        ok: false,
        error: converted.warnings[0] ?? 'No importable turns',
        warnings: converted.warnings,
      }
    }

    const seed = buildSeedEvents(converted.turns)
    const cwd = looksLikeAbsolutePath(converted.cwd)
      ? converted.cwd
      : looksLikeAbsolutePath(body.fallbackCwd)
        ? body.fallbackCwd
        : undefined
    const sessionId = brandString<SessionId>(`session-import-${randomUUID()}`)
    const session = sessions.create(sessionId, {
      seed,
      meta: {
        ...(cwd ? { cwd } : {}),
        createdAt: Date.now(),
      },
    })

    // Best-effort durable title so the sidebar shows the import label.
    try {
      const firstUserSeq = seed.find(event => event.type === 'user/message')?.seq
      session.append('session/title', {
        title: converted.title,
        ...(firstUserSeq === undefined ? { messageSeqs: [] } : { messageSeqs: [firstUserSeq] }),
      })
    } catch {
      // Title plugin may reject; import still succeeded.
    }

    return {
      ok: true,
      sessionId: session.id,
      title: converted.title,
      warnings: converted.warnings,
      turnCount: converted.turns.length,
    }
  }

  return { ok: false, error: `unknown op` } satisfies DesktopSessionImportErrorResponse
}

/** Handle POST /api/desktop/session-import. */
export async function handleDesktopSessionImportRequest(
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
  if (req.url !== DESKTOP_SESSION_IMPORT_PATH && req.url?.split('?')[0] !== DESKTOP_SESSION_IMPORT_PATH) {
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

  let body: DesktopSessionImportRequest
  try {
    body = JSON.parse(raw) as DesktopSessionImportRequest
  } catch {
    finishJson(res, 400, { ok: false, error: 'invalid json' })
    return
  }
  if (!body || typeof body.op !== 'string' || !OPS.has(body.op)) {
    finishJson(res, 400, { ok: false, error: 'invalid op' })
    return
  }

  try {
    const result = executeOp(ctx, body)
    const ok = (result as { ok?: boolean }).ok !== false
    finishJson(res, ok ? 200 : 400, result)
  } catch (error) {
    finishJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'import failed',
    })
  }
}

export { DESKTOP_SESSION_IMPORT_PATH }
