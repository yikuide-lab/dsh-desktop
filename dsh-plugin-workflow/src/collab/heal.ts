/** NetworkHealer pure parse/validate/apply — proposes mutations only */

import {
  inviteMember,
  pauseMember,
} from './membership.js'
import type {
  CollabEvent,
  CollabVision,
  HealAction,
  HealApplyResult,
  HealMutation,
  HealPlan,
  HealSeverity,
  LoopRoster,
} from './types.js'

const HEAL_SEVERITIES: HealSeverity[] = ['info', 'warn', 'crit']
const HEAL_ACTION_TYPES = new Set([
  'nudge_rejoin',
  'reassign_goal',
  'invite',
  'isolate',
  'spawn_repair_branch',
  'escalate_admin',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

export function parseHealPlan(raw: unknown): HealPlan {
  if (!isRecord(raw)) {
    throw new Error('HealPlan must be an object')
  }
  return {
    loopId: String(raw.loopId ?? ''),
    at: String(raw.at ?? ''),
    healthScore: Number(raw.healthScore ?? 0),
    findings: Array.isArray(raw.findings)
      ? raw.findings.map((finding) => {
          if (!isRecord(finding)) throw new Error('Heal finding must be an object')
          return {
            jid: finding.jid === undefined ? undefined : String(finding.jid),
            code: String(finding.code ?? ''),
            detail: String(finding.detail ?? ''),
            severity: String(finding.severity ?? 'info') as HealSeverity,
          }
        })
      : [],
    actions: Array.isArray(raw.actions)
      ? raw.actions.map((action) => parseHealAction(action))
      : [],
  }
}

function parseHealAction(raw: unknown): HealAction {
  if (!isRecord(raw) || !isString(raw.type)) {
    throw new Error('HealAction must be an object with type')
  }
  switch (raw.type) {
    case 'nudge_rejoin':
      return { type: 'nudge_rejoin', jid: String(raw.jid ?? '') }
    case 'reassign_goal':
      return {
        type: 'reassign_goal',
        goalId: String(raw.goalId ?? ''),
        toJid: raw.toJid === undefined ? undefined : String(raw.toJid),
        toSlot: raw.toSlot === undefined ? undefined : String(raw.toSlot),
      }
    case 'invite':
      return {
        type: 'invite',
        slot: String(raw.slot ?? ''),
        role: String(raw.role ?? ''),
        reason: String(raw.reason ?? ''),
        kind: raw.kind === undefined
          ? undefined
          : (String(raw.kind) as 'session' | 'agent' | 'workflow'),
      }
    case 'isolate':
      return {
        type: 'isolate',
        jid: String(raw.jid ?? ''),
        reason: String(raw.reason ?? ''),
      }
    case 'spawn_repair_branch':
      return {
        type: 'spawn_repair_branch',
        goalIds: isStringArray(raw.goalIds) ? raw.goalIds : [],
        hint: String(raw.hint ?? ''),
      }
    case 'escalate_admin':
      return { type: 'escalate_admin', message: String(raw.message ?? '') }
    default:
      throw new Error(`Unknown HealAction type: ${raw.type}`)
  }
}

export function validateHealPlan(plan: HealPlan): void {
  if (!plan.loopId.trim()) throw new Error('HealPlan.loopId is required')
  if (!plan.at.trim()) throw new Error('HealPlan.at is required')
  if (!isNumber(plan.healthScore)) throw new Error('HealPlan.healthScore must be a number')
  if (plan.healthScore < 0 || plan.healthScore > 100) {
    throw new Error('HealPlan.healthScore must be between 0 and 100')
  }
  for (const finding of plan.findings) {
    if (!finding.code.trim()) throw new Error('Heal finding code is required')
    if (!HEAL_SEVERITIES.includes(finding.severity)) {
      throw new Error(`Invalid heal finding severity: ${finding.severity}`)
    }
  }
  for (const action of plan.actions) {
    validateHealAction(action)
  }
}

function validateHealAction(action: HealAction): void {
  if (!HEAL_ACTION_TYPES.has(action.type)) {
    throw new Error(`Unknown HealAction type: ${action.type}`)
  }
  switch (action.type) {
    case 'nudge_rejoin':
      if (!action.jid.trim()) throw new Error('nudge_rejoin.jid is required')
      break
    case 'reassign_goal':
      if (!action.goalId.trim()) throw new Error('reassign_goal.goalId is required')
      if (!action.toJid && !action.toSlot) {
        throw new Error('reassign_goal requires toJid or toSlot')
      }
      break
    case 'invite':
      if (!action.slot.trim()) throw new Error('invite.slot is required')
      if (!action.role.trim()) throw new Error('invite.role is required')
      break
    case 'isolate':
      if (!action.jid.trim()) throw new Error('isolate.jid is required')
      break
    case 'spawn_repair_branch':
      if (!action.goalIds.length) throw new Error('spawn_repair_branch.goalIds is required')
      break
    case 'escalate_admin':
      if (!action.message.trim()) throw new Error('escalate_admin.message is required')
      break
  }
}

function reassignGoal(
  vision: CollabVision,
  goalId: string,
  toJid: string | undefined,
  toSlot: string | undefined,
  nowMs: number,
): { vision: CollabVision; events: CollabEvent[] } {
  const events: CollabEvent[] = []
  const goals = vision.goals.map((goal) => {
    if (goal.id !== goalId) return goal
    events.push({
      type: 'goal.reassigned',
      at: new Date(nowMs).toISOString(),
      goalId,
      jid: toJid,
      slot: toSlot,
    })
    return {
      ...goal,
      status: 'open' as const,
      ownerJid: toJid,
      slot: toSlot ?? goal.slot,
    }
  })
  return {
    vision: { ...vision, goals, updatedAt: new Date(nowMs).toISOString() },
    events,
  }
}

/** Always returns proposed mutations; does not gate on canHealAuto. */
export function applyHealActions(input: {
  plan: HealPlan
  roster: LoopRoster
  vision?: CollabVision
  nowMs?: number
}): HealApplyResult {
  const nowMs = input.nowMs ?? Date.now()
  let roster = input.roster
  let vision = input.vision
  const events: CollabEvent[] = []
  const mutations: HealMutation[] = []

  for (const action of input.plan.actions) {
    switch (action.type) {
      case 'nudge_rejoin': {
        mutations.push({ type: 'nudge_rejoin', jid: action.jid })
        events.push({ type: 'heal.nudge', at: new Date(nowMs).toISOString(), jid: action.jid })
        break
      }
      case 'reassign_goal': {
        mutations.push({
          type: 'reassign_goal',
          goalId: action.goalId,
          toJid: action.toJid,
          toSlot: action.toSlot,
        })
        if (vision) {
          const reassigned = reassignGoal(
            vision,
            action.goalId,
            action.toJid,
            action.toSlot,
            nowMs,
          )
          vision = reassigned.vision
          events.push(...reassigned.events)
        }
        break
      }
      case 'invite': {
        const kind = action.kind ?? 'session'
        mutations.push({
          type: 'invite',
          slot: action.slot,
          role: action.role,
          reason: action.reason,
          kind,
        })
        const invited = inviteMember({
          roster,
          slot: action.slot,
          role: action.role,
          kind,
          nowMs,
        })
        roster = invited.roster
        events.push(...invited.events)
        break
      }
      case 'isolate': {
        mutations.push({ type: 'isolate', jid: action.jid, reason: action.reason })
        const paused = pauseMember({ roster, jid: action.jid, nowMs })
        roster = paused.roster
        events.push(...paused.events)
        break
      }
      case 'spawn_repair_branch': {
        mutations.push({
          type: 'spawn_repair_branch',
          goalIds: action.goalIds,
          hint: action.hint,
        })
        break
      }
      case 'escalate_admin': {
        mutations.push({ type: 'escalate_admin', message: action.message })
        events.push({
          type: 'heal.escalate',
          at: new Date(nowMs).toISOString(),
          detail: action.message,
        })
        break
      }
    }
  }

  return {
    roster,
    vision,
    events,
    mutations,
  }
}

/** Low-risk actions eligible for auto-heal when canHealAuto is enabled. */
export function isLowRiskHealAction(action: HealAction): boolean {
  return action.type === 'nudge_rejoin'
    || action.type === 'reassign_goal'
    || action.type === 'invite'
}
