/**
 * Render smoke for the session-import overlay shell.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SessionImportOverlay } from '../src/client/SessionImportOverlay.tsx'

describe('session-import overlay render smoke', () => {
  it('renders the dialog when the panel is open', () => {
    const html = renderToStaticMarkup(createElement(SessionImportOverlay, {
      useStore: (sel: (state: { panelOpen: boolean }) => unknown) => sel({ panelOpen: true }),
      actions: { setPanelOpen: () => undefined },
      api: {
        list: async () => [],
        search: async () => [],
        importSession: async () => ({ sessionId: 'x', title: 't', warnings: [], turnCount: 0 }),
      },
      t: (key: string) => key,
      useSessions: (sel: (state: { byId: Record<string, never>; current: null }) => unknown) => sel({ byId: {}, current: null }),
      openImportedSession: () => undefined,
    } as never))
    expect(html).toContain('dshSessionImportDialog')
    expect(html).toContain('title')
    expect(html).toContain('importSelected')
  })
})
