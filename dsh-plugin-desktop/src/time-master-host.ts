/**
 * Desktop Time Master Plugin
 * Host HTTP bridge for token-plan registry + hourly expiry reminders.
 */

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from './runtime.ts'
import { DESKTOP_TIME_MASTER_PATH } from './desktop-time-master-contract.ts'
import { handleDesktopTimeMasterRequest } from './desktop-time-master-route.ts'
import {
  collectDueReminders,
  isPastReminderHour,
  markRemindersSent,
  readTimeMasterStore,
  resolveTimeMasterStorePath,
  writeTimeMasterStore,
} from './time-master/index.ts'
import {
  DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE,
  type DesktopNotificationSettings,
} from './notifications.ts'

export const name = 'desktop-time-master'

export const inject = ['webServer', 'connection'] as const

const CHECK_INTERVAL_MS = 60 * 60 * 1000

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopTimeMaster: DesktopTimeMasterService
  }
}

function notificationsEnabled(ctx: Context): boolean {
  try {
    const settings = ctx.get('settings') as
      | { get?: (ns: string) => DesktopNotificationSettings }
      | undefined
    const value = settings?.get?.(DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE)
    if (value && typeof value.enabled === 'boolean') return value.enabled
  } catch {
    // settings may be absent in minimal hosts
  }
  return true
}

function runReminderPass(ctx: Context): void {
  if (!isPastReminderHour()) return
  if (!notificationsEnabled(ctx)) return
  const runtime = ctx.get('desktopRuntime') as
    | { notifyAttention: (n: { title: string; body: string }) => void; locale?: string }
    | undefined
  if (!runtime?.notifyAttention) return

  const path = resolveTimeMasterStorePath()
  let store = readTimeMasterStore(path)
  const locale = runtime.locale === 'en' ? 'en' : 'zh'
  const due = collectDueReminders({
    plans: store.plans,
    projects: store.projects,
    schedules: store.schedules,
    remindersSent: store.remindersSent,
    locale,
  })
  if (due.length === 0) return

  for (const item of due) {
    try {
      runtime.notifyAttention({ title: item.title, body: item.body })
      store = markRemindersSent(store, item.entityId, [item.key])
    } catch {
      // Keep key unsent so the next pass can retry.
    }
  }
  writeTimeMasterStore(path, store)
}

export class DesktopTimeMasterService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'desktopTimeMaster')

    ctx.effect(() => {
      const rendererOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`
      const unregister = ctx.webServer.register({
        kind: 'exact',
        path: DESKTOP_TIME_MASTER_PATH,
        handler: (req, res) => {
          const rejection = ctx.connection.requestRejection(req)
          if (rejection !== undefined) {
            res.writeHead(rejection)
            res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
            return
          }
          return handleDesktopTimeMasterRequest(req, res, rendererOrigin, ctx)
        },
      })
      return () => { unregister() }
    }, 'dsh-plugin-desktop: time-master HTTP bridge')

    ctx.effect(() => {
      const tick = (): void => {
        try {
          runReminderPass(ctx)
        } catch (error) {
          ctx.logger.warn(
            `dsh-plugin-desktop: time-master reminder pass failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }
      }
      tick()
      const timer = setInterval(tick, CHECK_INTERVAL_MS)
      return () => { clearInterval(timer) }
    }, 'dsh-plugin-desktop: time-master reminder timer')
  }
}

export function apply(ctx: Context): void {
  void ctx.plugin(DesktopTimeMasterService)
}
