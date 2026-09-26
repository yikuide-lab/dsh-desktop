/**
 * Render smoke for the Time Master overlay shell.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TimeMasterOverlay } from '../src/client/TimeMasterOverlay.tsx'

const stubApi = {
  list: async () => ({
    today: '2026-09-25',
    version: 2,
    plans: [],
    schedules: [],
    projects: [],
  }),
  upsert: async () => ({
    plan: {
      id: 'p1',
      name: 'x',
      cycle: 'monthly' as const,
      expiresAt: '2026-10-01',
      remindDays: [7, 3, 1, 0],
      createdAt: '',
      updatedAt: '',
    },
    urgency: 'ok' as const,
  }),
  delete: async () => undefined,
  contextSnapshot: async () => ({
    providers: [],
    tokenPlanRoutes: [],
    workflowProviders: [],
    templates: [],
    today: '2026-09-25',
    sessions: [],
    workflowNames: [],
  }),
  aiSuggest: async () => ({ draft: { name: 'Claude Pro', expiresAt: '2026-10-25' }, source: 'heuristic' as const }),
  scheduleList: async () => ({ schedules: [] }),
  scheduleUpsert: async () => ({
    schedule: {
      id: 's1',
      name: 'S',
      horizonDays: 30,
      items: [],
      createdAt: '',
      updatedAt: '',
    },
  }),
  scheduleDelete: async () => undefined,
  aiOrchestrateUsage: async () => ({
    draft: { name: 'Usage', horizonDays: 30, items: [] },
    source: 'heuristic' as const,
  }),
  projectList: async () => ({ projects: [] }),
  projectUpsert: async () => ({
    project: {
      id: 'pr1',
      title: 'P',
      goal: 'G',
      status: 'active' as const,
      tasks: [],
      createdAt: '',
      updatedAt: '',
    },
  }),
  projectDelete: async () => undefined,
  aiPlanProject: async () => ({
    draft: { title: 'P', goal: 'G', tasks: [] },
    source: 'heuristic' as const,
  }),
  coordSnapshot: async () => ({
    snapshot: { today: '2026-09-25', activeTasks: [], conflicts: [] },
  }),
  aiCoordinate: async () => ({
    suggestions: [],
    source: 'heuristic' as const,
    snapshot: { today: '2026-09-25', activeTasks: [], conflicts: [] },
    applied: false,
  }),
}

describe('time-master overlay render smoke', () => {
  it('renders the dialog when the panel is open', () => {
    const html = renderToStaticMarkup(createElement(TimeMasterOverlay, {
      useStore: (sel: (state: { panelOpen: boolean }) => unknown) => sel({ panelOpen: true }),
      actions: { setPanelOpen: () => undefined },
      api: stubApi,
      t: (key: string) => key,
    } as never))
    expect(html).toContain('dshTimeMasterDialog')
    expect(html).toContain('dshTimeMasterFormActions')
    expect(html).toContain('dshTimeMasterTabs')
    expect(html).toContain('tabPlans')
    expect(html).toContain('tabSchedules')
    expect(html).toContain('save')
  })
})
