/** Same-origin browser client for Desktop Collab Loop ops. */

import type { DesktopCollabOp, DesktopCollabRequest } from '../desktop-collab-contract.ts'
import { DESKTOP_COLLAB_PATH } from '../desktop-collab-contract.ts'

export const DEFAULT_COLLAB_ACTOR_JID = 'admin@desktop.local/control'

export interface DesktopCollabApi {
  call<T extends Record<string, unknown> = Record<string, unknown>>(
    body: DesktopCollabRequest,
  ): Promise<{ ok: true } & T>
}

async function collabCall<T extends Record<string, unknown>>(
  body: DesktopCollabRequest,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<{ ok: true } & T> {
  const response = await fetcher(DESKTOP_COLLAB_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await response.json() as { ok?: boolean; error?: string } & T
  if (!response.ok || json.ok === false) {
    throw new Error(json.error ?? `collab failed (${response.status})`)
  }
  return json as { ok: true } & T
}

export function createDesktopCollabApi(
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): DesktopCollabApi {
  return {
    call(body) {
      return collabCall(body, fetcher)
    },
  }
}

export type { DesktopCollabOp, DesktopCollabRequest }
export { DESKTOP_COLLAB_PATH }
