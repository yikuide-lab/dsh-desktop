/** Coordination snapshot and rule-based conflict detection. */

import { daysBetween, localDateString } from './dates.js'
import type {
  CoordConflict,
  CoordSuggestion,
  ProjectPlan,
  ProjectTask,
  TokenPlan,
  UsageSchedule,
} from './types.js'

export interface ActiveTaskView {
  readonly projectId: string
  readonly projectTitle: string
  readonly task: ProjectTask
}

export interface CoordSnapshot {
  readonly today: string
  readonly activeTasks: ActiveTaskView[]
  readonly conflicts: CoordConflict[]
}

const SESSION_OVERLOAD_THRESHOLD = 3

function activeTasks(projects: readonly ProjectPlan[]): ActiveTaskView[] {
  const out: ActiveTaskView[] = []
  for (const project of projects) {
    if (project.status !== 'active') continue
    for (const task of project.tasks) {
      if (task.status === 'done') continue
      out.push({ projectId: project.id, projectTitle: project.title, task })
    }
  }
  return out
}

function detectDueOverlap(tasks: ActiveTaskView[]): CoordConflict[] {
  const byDate = new Map<string, string[]>()
  for (const entry of tasks) {
    if (!entry.task.dueAt) continue
    const ids = byDate.get(entry.task.dueAt) ?? []
    ids.push(`${entry.projectId}:${entry.task.id}`)
    byDate.set(entry.task.dueAt, ids)
  }
  const conflicts: CoordConflict[] = []
  for (const [date, taskIds] of byDate) {
    if (taskIds.length < 2) continue
    conflicts.push({
      code: 'due_overlap',
      taskIds,
      detail: `Multiple tasks due on ${date}`,
    })
  }
  return conflicts
}

function detectSessionOverload(tasks: ActiveTaskView[]): CoordConflict[] {
  const bySession = new Map<string, string[]>()
  for (const entry of tasks) {
    if (!entry.task.sessionId) continue
    const ids = bySession.get(entry.task.sessionId) ?? []
    ids.push(`${entry.projectId}:${entry.task.id}`)
    bySession.set(entry.task.sessionId, ids)
  }
  const conflicts: CoordConflict[] = []
  for (const [sessionId, taskIds] of bySession) {
    if (taskIds.length < SESSION_OVERLOAD_THRESHOLD) continue
    conflicts.push({
      code: 'session_overload',
      taskIds,
      detail: `Session ${sessionId} has ${taskIds.length} active tasks`,
    })
  }
  return conflicts
}

function detectPlanWindowMiss(
  tasks: ActiveTaskView[],
  schedules: readonly UsageSchedule[],
  plans: readonly TokenPlan[],
): CoordConflict[] {
  const conflicts: CoordConflict[] = []
  const planById = new Map(plans.map(plan => [plan.id, plan]))

  for (const entry of tasks) {
    if (!entry.task.planId || !entry.task.dueAt) continue
    const plan = planById.get(entry.task.planId)
    if (!plan) continue

    let inWindow = false
    for (const schedule of schedules) {
      for (const item of schedule.items) {
        if (item.planId !== entry.task.planId) continue
        if (item.role === 'idle') continue
        const startOk = daysBetween(item.windowStart, entry.task.dueAt)
        const endOk = daysBetween(entry.task.dueAt, item.windowEnd)
        if (startOk !== null && endOk !== null && startOk >= 0 && endOk >= 0) {
          inWindow = true
          break
        }
      }
      if (inWindow) break
    }

    if (!inWindow && schedules.some(s => s.items.some(i => i.planId === entry.task.planId))) {
      conflicts.push({
        code: 'plan_window_miss',
        taskIds: [`${entry.projectId}:${entry.task.id}`],
        detail: `Task "${entry.task.title}" due ${entry.task.dueAt} falls outside active windows for plan "${plan.name}"`,
      })
    }
  }
  return conflicts
}

export function buildCoordSnapshot(input: {
  projects: readonly ProjectPlan[]
  schedules: readonly UsageSchedule[]
  plans: readonly TokenPlan[]
  today?: string
}): CoordSnapshot {
  const today = input.today ?? localDateString()
  const tasks = activeTasks(input.projects)
  const conflicts = [
    ...detectDueOverlap(tasks),
    ...detectSessionOverload(tasks),
    ...detectPlanWindowMiss(tasks, input.schedules, input.plans),
  ]
  return { today, activeTasks: tasks, conflicts }
}

/** Heuristic reschedule suggestions for detected conflicts. */
export function heuristicCoordinate(input: {
  snapshot: CoordSnapshot
  projects: readonly ProjectPlan[]
}): CoordSuggestion[] {
  const suggestions: CoordSuggestion[] = []
  const projectById = new Map(input.projects.map(p => [p.id, p]))

  for (const conflict of input.snapshot.conflicts) {
    if (conflict.code === 'due_overlap') {
      const [, ...rest] = conflict.taskIds
      for (const ref of rest) {
        const [projectId, taskId] = ref.split(':')
        const project = projectById.get(projectId ?? '')
        const task = project?.tasks.find(t => t.id === taskId)
        if (!task?.dueAt) continue
        const shifted = shiftDate(task.dueAt, 1)
        if (!shifted) continue
        suggestions.push({
          taskId: ref,
          field: 'dueAt',
          value: shifted,
          reason: `Stagger +1 day to resolve due overlap on ${task.dueAt}`,
        })
      }
    }

    if (conflict.code === 'session_overload') {
      const [, ...rest] = conflict.taskIds
      for (const ref of rest) {
        suggestions.push({
          taskId: ref,
          field: 'sessionId',
          value: '',
          reason: 'Clear session binding to reduce overload',
        })
      }
    }

    if (conflict.code === 'plan_window_miss') {
      for (const ref of conflict.taskIds) {
        const [projectId, taskId] = ref.split(':')
        const project = projectById.get(projectId ?? '')
        const task = project?.tasks.find(t => t.id === taskId)
        if (!task?.dueAt) continue
        const shifted = shiftDate(task.dueAt, -2)
        if (!shifted) continue
        suggestions.push({
          taskId: ref,
          field: 'dueAt',
          value: shifted,
          reason: 'Move due date earlier to fit plan usage window',
        })
      }
    }
  }

  return suggestions
}

function shiftDate(isoDate: string, days: number): string | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!parts) return null
  const date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 12)
  date.setDate(date.getDate() + days)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Apply coordinate suggestions to a project (returns updated project). */
export function applyCoordSuggestions(
  project: ProjectPlan,
  suggestions: readonly CoordSuggestion[],
): ProjectPlan {
  const relevant = suggestions.filter(s => s.taskId.startsWith(`${project.id}:`))
  if (relevant.length === 0) return project

  const tasks = project.tasks.map(task => {
    const ref = `${project.id}:${task.id}`
    const patches = relevant.filter(s => s.taskId === ref)
    if (patches.length === 0) return task
    let next = { ...task }
    for (const patch of patches) {
      if (patch.field === 'dueAt') next = { ...next, dueAt: patch.value }
      if (patch.field === 'sessionId') {
        const { sessionId: _, ...rest } = next
        next = patch.value ? { ...rest, sessionId: patch.value } : rest
      }
      if (patch.field === 'workflowName') next = { ...next, workflowName: patch.value }
      if (patch.field === 'planId') next = { ...next, planId: patch.value }
    }
    return next
  })

  return { ...project, tasks, updatedAt: new Date().toISOString() }
}
