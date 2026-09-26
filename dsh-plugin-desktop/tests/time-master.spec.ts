/**
 * Time Master store, reminder keys, migration, and heuristic V2 helpers.
 */

import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildCoordSnapshot,
  collectDueReminders,
  deletePlan,
  emptyStore,
  heuristicCoordinate,
  heuristicOrchestrateUsage,
  heuristicPlanProject,
  heuristicSuggest,
  markRemindersSent,
  planReminderKey,
  planUrgency,
  readTimeMasterStore,
  taskReminderEntityId,
  taskReminderKey,
  upsertPlan,
  upsertProject,
  upsertSchedule,
  writeTimeMasterStore,
} from '../src/time-master/index.ts'
import type { TimeMasterContextSnapshot } from '../src/time-master/types.ts'

describe('time-master core', () => {
  it('persists plans.json with upsert and delete', () => {
    const dir = mkdtempSync(join(tmpdir(), 'time-master-'))
    const path = join(dir, 'plans.json')
    try {
      let store = emptyStore()
      expect(store.version).toBe(2)
      const created = upsertPlan(store, {
        name: 'Claude Pro',
        cycle: 'monthly',
        expiresAt: '2026-10-01',
        providerHint: 'claude',
      })
      store = created.store
      writeTimeMasterStore(path, store)
      const raw = readFileSync(path, 'utf8')
      expect(raw).toContain('Claude Pro')
      expect(raw).toContain('"version": 2')
      const reloaded = readTimeMasterStore(path)
      expect(reloaded.plans).toHaveLength(1)
      expect(reloaded.plans[0]?.expiresAt).toBe('2026-10-01')
      expect(reloaded.schedules).toEqual([])
      expect(reloaded.projects).toEqual([])
      store = deletePlan(reloaded, created.plan.id)
      writeTimeMasterStore(path, store)
      expect(readTimeMasterStore(path).plans).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('migrates v1 store to v2 without losing plans', () => {
    const dir = mkdtempSync(join(tmpdir(), 'time-master-v1-'))
    const path = join(dir, 'plans.json')
    try {
      writeFileSync(path, JSON.stringify({
        version: 1,
        plans: [{
          id: 'plan-1',
          name: 'Legacy Plan',
          cycle: 'monthly',
          expiresAt: '2026-12-01',
          remindDays: [7, 3, 1, 0],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
        remindersSent: {
          'plan-1': ['2026-12-01|d7'],
        },
      }, null, 2))
      const store = readTimeMasterStore(path)
      expect(store.version).toBe(2)
      expect(store.plans).toHaveLength(1)
      expect(store.plans[0]?.name).toBe('Legacy Plan')
      expect(store.schedules).toEqual([])
      expect(store.projects).toEqual([])
      expect(store.remindersSent['plan-1']).toContain('plan:2026-12-01|d7')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('computes prefixed plan reminder keys and due reminders without duplicates', () => {
    const plan = upsertPlan(emptyStore(), {
      name: 'Codex Plus',
      expiresAt: '2026-09-28',
      remindDays: [7, 3, 1, 0],
    }).plan
    expect(planReminderKey(plan.expiresAt, 3)).toBe('plan:2026-09-28|d3')
    const due = collectDueReminders({
      plans: [plan],
      remindersSent: {},
      today: '2026-09-25',
      locale: 'zh',
    })
    expect(due).toHaveLength(1)
    expect(due[0]?.kind).toBe('plan')
    expect(due[0]?.key).toBe('plan:2026-09-28|d3')
    expect(due[0]?.body).toContain('Codex Plus')
    const marked = markRemindersSent(emptyStore(), plan.id, [due[0]!.key])
    const again = collectDueReminders({
      plans: [plan],
      remindersSent: marked.remindersSent,
      today: '2026-09-25',
    })
    expect(again).toHaveLength(0)
  })

  it('fires task due reminders with task: prefix keys', () => {
    let store = emptyStore()
    const plan = upsertPlan(store, { name: 'P', expiresAt: '2026-12-01' }).plan
    store = upsertPlan(store, { name: 'P', expiresAt: '2026-12-01' }).store
    const project = upsertProject(store, {
      title: 'Ship feature',
      goal: 'Deliver V2',
      tasks: [{ title: 'Finish tests', dueAt: '2026-09-28', status: 'todo' }],
    }).project
    const task = project.tasks[0]!
    const entityId = taskReminderEntityId(project.id, task.id)
    const due = collectDueReminders({
      plans: [plan],
      projects: [project],
      remindersSent: {},
      today: '2026-09-25',
    })
    const taskDue = due.filter(item => item.kind === 'task')
    expect(taskDue.length).toBeGreaterThan(0)
    expect(taskDue[0]?.key).toBe(taskReminderKey(task.id, '2026-09-28', 3))
    expect(taskDue[0]?.entityId).toBe(entityId)
    expect(due.some(item => item.kind === 'plan')).toBe(false)
  })

  it('classifies urgency and heuristic drafts', () => {
    const plan = upsertPlan(emptyStore(), {
      name: 'Cursor Pro',
      expiresAt: '2026-09-26',
    }).plan
    expect(planUrgency(plan, '2026-09-25')).toBe('soon')
    expect(planUrgency(plan, '2026-09-27')).toBe('expired')
    expect(planUrgency({ ...plan, expiresAt: '2026-12-01' }, '2026-09-25')).toBe('ok')

    const context: TimeMasterContextSnapshot = {
      providers: [{ id: 'claude', name: 'Claude', models: ['claude-opus'] }],
      tokenPlanRoutes: ['qwen-token-plan'],
      workflowProviders: [],
      templates: [],
      today: '2026-09-25',
      sessions: [],
      workflowNames: ['problem-loop'],
    }
    const draft = heuristicSuggest({ context, hint: 'claude' })
    expect(draft.name).toMatch(/Claude/i)
    expect(draft.expiresAt).toBeTruthy()
    expect(draft.cycle).toBe('monthly')
  })

  it('heuristic orchestrate staggers plans by expiry', () => {
    let store = emptyStore()
    const p1 = upsertPlan(store, { name: 'A', expiresAt: '2026-10-01' }).plan
    store = upsertPlan(store, { name: 'A', expiresAt: '2026-10-01' }).store
    const p2 = upsertPlan(store, { name: 'B', expiresAt: '2026-11-01' }).plan
    const context: TimeMasterContextSnapshot = {
      providers: [],
      tokenPlanRoutes: [],
      workflowProviders: [],
      templates: [],
      today: '2026-09-25',
      sessions: [],
      workflowNames: [],
    }
    const draft = heuristicOrchestrateUsage({ plans: [p1, p2], context })
    expect(draft.items?.length).toBe(2)
    expect(draft.items?.[0]?.planId).toBe(p1.id)
    expect(draft.items?.[0]?.role).toBeTruthy()
    expect(draft.horizonDays).toBe(30)
  })

  it('heuristic plan project produces three tasks', () => {
    const context: TimeMasterContextSnapshot = {
      providers: [],
      tokenPlanRoutes: [],
      workflowProviders: [],
      templates: [],
      today: '2026-09-25',
      sessions: [],
      workflowNames: ['wf-a'],
    }
    const draft = heuristicPlanProject({ context, hint: 'Build Time Master V2' })
    expect(draft.tasks?.length).toBe(3)
    expect(draft.title).toContain('Time Master')
    expect(draft.tasks?.[0]?.workflowName).toBe('wf-a')
  })

  it('detects due_overlap conflicts and suggests stagger', () => {
    let store = emptyStore()
    store = upsertProject(store, {
      title: 'P',
      goal: 'G',
      tasks: [
        { title: 'T1', dueAt: '2026-09-28', status: 'todo' },
        { title: 'T2', dueAt: '2026-09-28', status: 'todo' },
      ],
    }).store
    const project = store.projects[0]!
    const snapshot = buildCoordSnapshot({ projects: store.projects, schedules: [], plans: [] })
    expect(snapshot.conflicts.some(c => c.code === 'due_overlap')).toBe(true)
    const suggestions = heuristicCoordinate({ snapshot, projects: [project] })
    expect(suggestions.length).toBeGreaterThan(0)
    expect(suggestions[0]?.field).toBe('dueAt')
  })

  it('upserts schedules and projects', () => {
    let store = emptyStore()
    const plan = upsertPlan(store, { name: 'X', expiresAt: '2026-12-01' }).plan
    store = upsertPlan(store, { name: 'X', expiresAt: '2026-12-01' }).store
    store = upsertSchedule(store, {
      name: 'Q4 usage',
      horizonDays: 30,
      items: [{
        planId: plan.id,
        role: 'primary',
        windowStart: '2026-09-25',
        windowEnd: '2026-10-25',
      }],
    }).store
    expect(store.schedules).toHaveLength(1)
    store = upsertProject(store, {
      title: 'Demo',
      goal: 'Test',
      tasks: [{ title: 'Step 1', status: 'todo' }],
    }).store
    expect(store.projects).toHaveLength(1)
    expect(store.projects[0]?.tasks).toHaveLength(1)
  })
})
