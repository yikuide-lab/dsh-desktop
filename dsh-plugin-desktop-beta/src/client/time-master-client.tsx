import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TimeMasterLocaleKey } from './locales-time-master.js'
import { en, ja, ko, zh } from './locales-time-master.js'
import { installTimeMasterStyles } from './styles-time-master.js'
import { createDesktopTimeMasterApi } from './time-master-api.js'
import { createTimeMasterStore } from './time-master-store.js'
import { TimeMasterLauncher } from './TimeMasterLauncher.js'
import { TimeMasterOverlay } from './TimeMasterOverlay.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-plugin-desktop/time-master': TimeMasterLocaleKey
  }
}

export const inject = ['slots', 'locale']
export const NS = 'dsh-plugin-desktop/time-master'

/** Register Time Master launcher, overlay, locale, and styles. */
export function applyTimeMasterClient(ctx: ClientContext): void {
  const viewHandle = createTimeMasterStore()
  const view = viewHandle.create()
  const store = { ...viewHandle, create: () => view }
  const api = createDesktopTimeMasterApi()

  const openTimeMasterPanel = (): void => {
    view.actions.setPanelOpen(true)
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, ko }), 'dsh-plugin-desktop/time-master: dictionaries')
  ctx.effect(() => installTimeMasterStyles(), 'dsh-plugin-desktop/time-master: styles')

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'time-master',
    order: 19,
    label: () => ctx.locale.bind(NS)('tab'),
    locale: NS,
    store,
    inject: () => ({ openTimeMasterPanel }),
  }, TimeMasterLauncher))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'time-master',
    order: 26,
    locale: NS,
    store,
    inject: () => ({ api }),
  }, TimeMasterOverlay as unknown as (props: PropsRuntime<'shell.overlay'>) => null))
}
