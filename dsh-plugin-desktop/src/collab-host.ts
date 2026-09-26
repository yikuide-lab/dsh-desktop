/**
 * Desktop Collab Host Plugin
 * HTTP bridge + stability/healer background ticks for Collab Loops.
 */

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { DESKTOP_COLLAB_PATH } from './desktop-collab-contract.ts'
import { handleDesktopCollabRequest } from './desktop-collab-route.ts'
import { runHealerPass, runStabilityPass } from './collab-host/index.ts'

export const name = 'desktop-collab'

export const inject = ['webServer', 'connection'] as const

const STABILITY_INTERVAL_MS = 5_000
const HEALER_INTERVAL_MS = 60_000

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopCollab: DesktopCollabService
  }
}

export class DesktopCollabService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'desktopCollab')

    ctx.effect(() => {
      const rendererOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`
      const unregister = ctx.webServer.register({
        kind: 'exact',
        path: DESKTOP_COLLAB_PATH,
        handler: (req, res) => {
          const rejection = ctx.connection.requestRejection(req)
          if (rejection !== undefined) {
            res.writeHead(rejection)
            res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
            return
          }
          return handleDesktopCollabRequest(req, res, rendererOrigin, ctx)
        },
      })
      return () => { unregister() }
    }, 'dsh-plugin-desktop: collab HTTP bridge')

    ctx.effect(() => {
      const tick = (): void => {
        void runStabilityPass().catch((error) => {
          ctx.logger.warn(
            `dsh-plugin-desktop: collab stability tick failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        })
      }
      tick()
      const timer = setInterval(tick, STABILITY_INTERVAL_MS)
      return () => { clearInterval(timer) }
    }, 'dsh-plugin-desktop: collab stability timer')

    ctx.effect(() => {
      const tick = (): void => {
        void runHealerPass(undefined, ctx).catch((error) => {
          ctx.logger.warn(
            `dsh-plugin-desktop: collab healer tick failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        })
      }
      const timer = setInterval(tick, HEALER_INTERVAL_MS)
      return () => { clearInterval(timer) }
    }, 'dsh-plugin-desktop: collab healer timer')
  }
}

export function apply(ctx: Context): void {
  void ctx.plugin(DesktopCollabService)
}
