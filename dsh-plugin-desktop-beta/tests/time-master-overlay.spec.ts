/**
 * Render smoke for the Time Master overlay shell.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TimeMasterOverlay } from '../src/client/TimeMasterOverlay.tsx'

describe('time-master overlay render smoke', () => {
  it('renders the dialog when the panel is open', () => {
    const html = renderToStaticMarkup(createElement(TimeMasterOverlay, {
      useStore: (sel: (state: { panelOpen: boolean }) => unknown) => sel({ panelOpen: true }),
      actions: { setPanelOpen: () => undefined },
      api: {
        list: async () => ({ today: '2026-09-25', plans: [] }),
        upsert: async () => ({
          plan: {
            id: 'p1',
            name: 'x',
            cycle: 'monthly',
            expiresAt: '2026-10-01',
            remindDays: [7, 3, 1, 0],
            createdAt: '',
            updatedAt: '',
          },
          urgency: 'ok',
        }),
        delete: async () => undefined,
        contextSnapshot: async () => ({
          providers: [],
          tokenPlanRoutes: [],
          workflowProviders: [],
          templates: [],
          today: '2026-09-25',
        }),
        aiSuggest: async () => ({ draft: { name: 'Claude Pro', expiresAt: '2026-10-25' }, source: 'heuristic' }),
      },
      t: (key: string) => key,
    } as never))
    expect(html).toContain('dshTimeMasterDialog')
    expect(html).toContain('dshTimeMasterFormActions')
    expect(html).toContain('title')
    expect(html).toContain('aiFill')
    expect(html).toContain('newPlan')
    expect(html).toContain('save')
  })
})
