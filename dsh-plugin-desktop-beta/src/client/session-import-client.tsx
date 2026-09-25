import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionImportLocaleKey } from './locales-session-import.js'
import { en, zh } from './locales-session-import.js'
import { installSessionImportStyles } from './styles-session-import.js'
import { createDesktopSessionImportApi } from './session-import-api.js'
import { createSessionImportStore } from './session-import-store.js'
import { SessionImportLauncher } from './SessionImportLauncher.js'
import { SessionImportOverlay } from './SessionImportOverlay.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-plugin-desktop/session-import': SessionImportLocaleKey
  }
}

export const inject = ['slots', 'locale']
export const NS = 'dsh-plugin-desktop/session-import'

type UiWorkspaceFace = {
  openSession: (sessionId: SessionId) => void
}

/** Register session-import launcher, overlay, locale, and styles. */
export function applySessionImportClient(ctx: ClientContext): void {
  const viewHandle = createSessionImportStore()
  const view = viewHandle.create()
  const store = { ...viewHandle, create: () => view }
  const api = createDesktopSessionImportApi()

  const openSessionImportPanel = (): void => {
    view.actions.setPanelOpen(true)
  }

  const openImportedSession = (sessionId: SessionId): void => {
    const workspace = ctx.get('uiWorkspace') as UiWorkspaceFace | undefined
    workspace?.openSession(sessionId)
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-plugin-desktop/session-import: dictionaries')
  ctx.effect(() => installSessionImportStyles(), 'dsh-plugin-desktop/session-import: styles')

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'session-import',
    order: 18,
    label: () => ctx.locale.bind(NS)('tab'),
    locale: NS,
    store,
    inject: () => ({ openSessionImportPanel }),
  }, SessionImportLauncher))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'session-import',
    order: 25,
    locale: NS,
    store,
    inject: () => ({ api, openImportedSession }),
  }, SessionImportOverlay as unknown as (props: PropsRuntime<'shell.overlay'>) => null))
}
