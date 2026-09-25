/** Same-origin browser client for Desktop harness session import. */

import type {
  ExternalSessionSource,
  ExternalSessionSummary,
  SessionImportImportResult,
} from '../session-import/types.js'

const SESSION_IMPORT_PATH = '/api/desktop/session-import'

export interface DesktopSessionImportApi {
  list(sources?: readonly ExternalSessionSource[]): Promise<ExternalSessionSummary[]>
  search(input: {
    query: string
    sources?: readonly ExternalSessionSource[]
    content?: boolean
  }): Promise<ExternalSessionSummary[]>
  importSession(input: {
    source: ExternalSessionSource
    id: string
    sourcePath: string
    fallbackCwd?: string
  }): Promise<SessionImportImportResult>
}

async function post<T>(body: object): Promise<T> {
  const response = await fetch(SESSION_IMPORT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await response.json() as { ok?: boolean; error?: string } & T
  if (!response.ok || json.ok === false) {
    throw new Error(json.error ?? `session-import failed (${response.status})`)
  }
  return json
}

export function createDesktopSessionImportApi(
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): DesktopSessionImportApi {
  const call = async <T>(body: object): Promise<T> => {
    const response = await fetcher(SESSION_IMPORT_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await response.json() as { ok?: boolean; error?: string; items?: ExternalSessionSummary[] } & T
    if (!response.ok || json.ok === false) {
      throw new Error((json as { error?: string }).error ?? `session-import failed (${response.status})`)
    }
    return json
  }

  return {
    async list(sources) {
      const result = await call<{ items: ExternalSessionSummary[] }>({ op: 'list', sources })
      return result.items ?? []
    },
    async search(input) {
      const result = await call<{ items: ExternalSessionSummary[] }>({
        op: 'search',
        query: input.query,
        sources: input.sources,
        content: input.content,
      })
      return result.items ?? []
    },
    async importSession(input) {
      const result = await call<SessionImportImportResult & { ok: true }>({
        op: 'import',
        source: input.source,
        id: input.id,
        sourcePath: input.sourcePath,
        fallbackCwd: input.fallbackCwd,
      })
      return {
        sessionId: result.sessionId,
        title: result.title,
        warnings: result.warnings ?? [],
        turnCount: result.turnCount,
      }
    },
  }
}

export { SESSION_IMPORT_PATH, post }
