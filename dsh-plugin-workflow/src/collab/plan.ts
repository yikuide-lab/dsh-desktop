/** TaskPlanner pure parse/validate/apply with assign > invite > branch > open priority */

import { inviteMember } from './membership.js'
import type {
  BranchRecord,
  CollabEvent,
  CollabVision,
  LoopRoster,
  PeerKind,
  TaskPlan,
  TaskPlanApplyResult,
  TaskPlanMutation,
  TaskPlanSubtask,
} from './types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

export function parseTaskPlan(raw: unknown): TaskPlan {
  if (!isRecord(raw)) {
    throw new Error('TaskPlan must be an object')
  }
  return {
    loopId: String(raw.loopId ?? ''),
    rootGoal: String(raw.rootGoal ?? ''),
    subtasks: Array.isArray(raw.subtasks)
      ? raw.subtasks.map((subtask) => parseSubtask(subtask))
      : [],
  }
}

function parseSubtask(raw: unknown): TaskPlanSubtask {
  if (!isRecord(raw)) throw new Error('TaskPlan subtask must be an object')
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? ''),
    acceptance: raw.acceptance === undefined ? undefined : (
      isStringArray(raw.acceptance) ? raw.acceptance : undefined
    ),
    dependsOn: raw.dependsOn === undefined ? undefined : (
      isStringArray(raw.dependsOn) ? raw.dependsOn : undefined
    ),
    preferredRole: raw.preferredRole === undefined ? undefined : String(raw.preferredRole),
    assignToJid: raw.assignToJid === undefined ? undefined : String(raw.assignToJid),
    inviteSlot: raw.inviteSlot === undefined ? undefined : String(raw.inviteSlot),
    branchHint: raw.branchHint === undefined ? undefined : String(raw.branchHint),
  }
}

export function validateTaskPlan(plan: TaskPlan): void {
  if (!plan.loopId.trim()) throw new Error('TaskPlan.loopId is required')
  if (!plan.rootGoal.trim()) throw new Error('TaskPlan.rootGoal is required')
  const ids = new Set<string>()
  for (const subtask of plan.subtasks) {
    if (!subtask.id.trim()) throw new Error('TaskPlan subtask id is required')
    if (ids.has(subtask.id)) throw new Error(`Duplicate subtask id: ${subtask.id}`)
    ids.add(subtask.id)
    if (!subtask.title.trim()) throw new Error(`Subtask ${subtask.id} title is required`)
    if (subtask.dependsOn) {
      for (const dep of subtask.dependsOn) {
        if (!ids.has(dep) && !plan.subtasks.some((s) => s.id === dep)) {
          throw new Error(`Subtask ${subtask.id} depends on unknown id: ${dep}`)
        }
      }
    }
    const directives = [
      subtask.assignToJid,
      subtask.inviteSlot,
      subtask.branchHint,
    ].filter(Boolean)
    if (directives.length > 1) {
      throw new Error(`Subtask ${subtask.id} has multiple dispatch directives`)
    }
  }
  assertAcyclic(plan)
}

function assertAcyclic(plan: TaskPlan): void {
  const graph = new Map<string, string[]>()
  for (const subtask of plan.subtasks) {
    graph.set(subtask.id, subtask.dependsOn ?? [])
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visited.has(id)) return
    if (visiting.has(id)) throw new Error(`TaskPlan dependency cycle detected at ${id}`)
    visiting.add(id)
    for (const dep of graph.get(id) ?? []) visit(dep)
    visiting.delete(id)
    visited.add(id)
  }
  for (const subtask of plan.subtasks) visit(subtask.id)
}

function isActiveMember(roster: LoopRoster, jid: string): boolean {
  return roster.members.some(
    (member) => member.jid === jid && member.lifecycle === 'active' && member.show !== 'OFFLINE',
  )
}

function upsertGoal(
  vision: CollabVision,
  subtask: TaskPlanSubtask,
  patch: Partial<CollabVision['goals'][number]>,
  nowMs: number,
): CollabVision {
  const existingIdx = vision.goals.findIndex((goal) => goal.id === subtask.id)
  const base = existingIdx >= 0
    ? vision.goals[existingIdx]
    : {
        id: subtask.id,
        title: subtask.title,
        status: 'open' as const,
        acceptance: subtask.acceptance,
      }
  const nextGoal = { ...base, ...patch, title: subtask.title, acceptance: subtask.acceptance ?? base.acceptance }
  const goals = [...vision.goals]
  if (existingIdx >= 0) goals[existingIdx] = nextGoal
  else goals.push(nextGoal)
  return { ...vision, goals, updatedAt: new Date(nowMs).toISOString() }
}

export function applyTaskPlanPriority(input: {
  plan: TaskPlan
  roster: LoopRoster
  vision?: CollabVision
  branches?: BranchRecord[]
  nowMs?: number
}): TaskPlanApplyResult {
  const nowMs = input.nowMs ?? Date.now()
  let roster = input.roster
  let vision = input.vision ?? {
    loopId: input.plan.loopId,
    threadId: input.plan.loopId,
    goals: [],
    facts: [],
    artifacts: [],
    updatedAt: new Date(nowMs).toISOString(),
  }
  const branches = [...(input.branches ?? [])]
  const events: CollabEvent[] = []
  const mutations: TaskPlanMutation[] = []

  for (const subtask of input.plan.subtasks) {
    if (subtask.assignToJid && isActiveMember(roster, subtask.assignToJid)) {
      mutations.push({
        type: 'assign_goal',
        goalId: subtask.id,
        toJid: subtask.assignToJid,
      })
      vision = upsertGoal(vision, subtask, {
        status: 'open',
        ownerJid: subtask.assignToJid,
      }, nowMs)
      events.push({
        type: 'goal.reassigned',
        at: new Date(nowMs).toISOString(),
        goalId: subtask.id,
        jid: subtask.assignToJid,
      })
      continue
    }

    if (subtask.inviteSlot) {
      const role = subtask.preferredRole ?? 'contributor'
      const kind: PeerKind = 'session'
      mutations.push({ type: 'invite', slot: subtask.inviteSlot, role, kind })
      const invited = inviteMember({ roster, slot: subtask.inviteSlot, role, kind, nowMs })
      roster = invited.roster
      events.push(...invited.events)
      vision = upsertGoal(vision, subtask, { status: 'open', slot: subtask.inviteSlot }, nowMs)
      continue
    }

    if (subtask.branchHint) {
      const branchId = `branch-${subtask.id}`
      const workflowName = `${subtask.branchHint}-${subtask.id}`
      mutations.push({
        type: 'spawn_branch',
        branchId,
        goalIds: [subtask.id],
        hint: subtask.branchHint,
        workflowName,
      })
      branches.push({
        branchId,
        loopId: input.plan.loopId,
        goalIds: [subtask.id],
        workflowName,
        parentLoopId: input.plan.loopId,
        status: 'draft',
        createdAt: new Date(nowMs).toISOString(),
      })
      vision = upsertGoal(vision, subtask, { status: 'open', branchId }, nowMs)
      events.push({
        type: 'branch.spawn',
        at: new Date(nowMs).toISOString(),
        goalId: subtask.id,
        detail: branchId,
      })
      continue
    }

    mutations.push({
      type: 'open_goal',
      goalId: subtask.id,
      title: subtask.title,
      acceptance: subtask.acceptance,
    })
    vision = upsertGoal(vision, subtask, { status: 'open' }, nowMs)
    events.push({
      type: 'goal.opened',
      at: new Date(nowMs).toISOString(),
      goalId: subtask.id,
    })
  }

  return { roster, vision, branches, events, mutations }
}
