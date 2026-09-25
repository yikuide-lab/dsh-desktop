/**
 * Desktop Session Import Plugin
 * Host HTTP bridge that scans Claude / Codex / OpenCode sessions and imports
 * them as seeded DSH sessions.
 */

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { DESKTOP_SESSION_IMPORT_PATH } from './desktop-session-import-contract.ts'
import { handleDesktopSessionImportRequest } from './desktop-session-import-route.ts'

export const name = 'desktop-session-import'

export const inject = ['webServer', 'connection'] as const

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopSessionImport: DesktopSessionImportService
  }
}

export class DesktopSessionImportService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'desktopSessionImport')

    ctx.effect(() => {
      const rendererOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`
      const unregister = ctx.webServer.register({
        kind: 'exact',
        path: DESKTOP_SESSION_IMPORT_PATH,
        handler: (req, res) => {
          const rejection = ctx.connection.requestRejection(req)
          if (rejection !== undefined) {
            res.writeHead(rejection)
            res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
            return
          }
          return handleDesktopSessionImportRequest(req, res, rendererOrigin, ctx)
        },
      })
      return () => { unregister() }
    }, 'dsh-plugin-desktop: session-import HTTP bridge')
  }
}

export function apply(ctx: Context): void {
  void ctx.plugin(DesktopSessionImportService)
}
