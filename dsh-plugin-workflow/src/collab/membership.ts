/** Pure membership mutations for LoopRoster + CollabVision */

import { parseJid, rosterPeerKindFromJid } from './jid.js'
import type {
  CollabEvent,
  CollabVision,
  LoopRoster,
  MembershipResult,
  PeerKind,
  RosterMember,
} from './types.js'

function isoNow(nowMs: number): string {
  return new Date(nowMs).toISOString()
}

function touchRoster(roster: LoopRoster, nowMs: number): LoopRoster {
  return { ...roster, updatedAt: isoNow(nowMs) }
}

function touchVision(vision: CollabVision, nowMs: number): CollabVision {
  return { ...vision, updatedAt: isoNow(nowMs) }
}

function findMemberIndex(members: RosterMember[], predicate: (m: RosterMember) => boolean): number {
  return members.findIndex(predicate)
}

function orphanGoalsForJid(vision: CollabVision, jid: string, nowMs: number): {
  vision: CollabVision
  events: CollabEvent[]
} {
  const events: CollabEvent[] = []
  const goals = vision.goals.map((goal) => {
    if (goal.ownerJid === jid && goal.status !== 'done') {
      events.push({
        type: 'goal.orphaned',
        at: isoNow(nowMs),
        jid,
        goalId: goal.id,
      })
      return { ...goal, status: 'orphaned' as const, ownerJid: undefined }
    }
    return goal
  })
  return { vision: touchVision({ ...vision, goals }, nowMs), events }
}

function claimOrphanedGoals(
  vision: CollabVision,
  jid: string,
  slot: string | undefined,
  nowMs: number,
): { vision: CollabVision; events: CollabEvent[] } {
  const events: CollabEvent[] = []
  const goals = vision.goals.map((goal) => {
    if (goal.status === 'orphaned' && (!goal.slot || goal.slot === slot)) {
      events.push({
        type: 'goal.reassigned',
        at: isoNow(nowMs),
        jid,
        goalId: goal.id,
      })
      return { ...goal, status: 'open' as const, ownerJid: jid, slot }
    }
    return goal
  })
  return { vision: touchVision({ ...vision, goals }, nowMs), events }
}

export function joinMember(input: {
  roster: LoopRoster
  vision?: CollabVision
  jid: string
  slot: string
  boundStepId?: string
  nowMs?: number
}): MembershipResult {
  const nowMs = input.nowMs ?? Date.now()
  const events: CollabEvent[] = []
  const kind = rosterPeerKindFromJid(input.jid)
  const members = [...input.roster.members]
  const idx = findMemberIndex(members, (m) => m.slot === input.slot)
  if (idx < 0) {
    throw new Error(`Slot not found: ${input.slot}`)
  }
  const existing = members[idx]
  if (existing.lifecycle !== 'vacant' && existing.lifecycle !== 'left') {
    throw new Error(`Slot ${input.slot} is not vacant`)
  }
  const epoch = (existing.epoch ?? 0) + 1
  members[idx] = {
    ...existing,
    jid: parseJid(input.jid).full,
    kind,
    slot: input.slot,
    lifecycle: 'active',
    show: 'ONLINE',
    lastSeenAt: isoNow(nowMs),
    joinedAt: isoNow(nowMs),
    leftAt: undefined,
    epoch,
    boundStepId: input.boundStepId,
    paused: false,
  }
  events.push({
    type: 'member.joined',
    at: isoNow(nowMs),
    jid: input.jid,
    slot: input.slot,
  })

  let vision = input.vision
  const visionEvents: CollabEvent[] = []
  if (vision) {
    const claimed = claimOrphanedGoals(vision, input.jid, input.slot, nowMs)
    vision = claimed.vision
    visionEvents.push(...claimed.events)
  }

  return {
    roster: touchRoster({ ...input.roster, members }, nowMs),
    vision,
    events: [...events, ...visionEvents],
  }
}

export function leaveMember(input: {
  roster: LoopRoster
  vision?: CollabVision
  jid: string
  nowMs?: number
}): MembershipResult {
  const nowMs = input.nowMs ?? Date.now()
  const events: CollabEvent[] = []
  const members = [...input.roster.members]
  const idx = findMemberIndex(members, (m) => m.jid === input.jid && m.lifecycle === 'active')
  if (idx < 0) {
    throw new Error(`Active member not found: ${input.jid}`)
  }
  const member = members[idx]
  members[idx] = {
    ...member,
    lifecycle: 'left',
    show: 'OFFLINE',
    leftAt: isoNow(nowMs),
    epoch: member.epoch + 1,
    paused: false,
  }
  events.push({ type: 'member.left', at: isoNow(nowMs), jid: input.jid, slot: member.slot })

  let vision = input.vision
  const visionEvents: CollabEvent[] = []
  if (vision) {
    const orphaned = orphanGoalsForJid(vision, input.jid, nowMs)
    vision = orphaned.vision
    visionEvents.push(...orphaned.events)
  }

  return {
    roster: touchRoster({ ...input.roster, members }, nowMs),
    vision,
    events: [...events, ...visionEvents],
  }
}

export function kickMember(input: {
  roster: LoopRoster
  vision?: CollabVision
  jid: string
  nowMs?: number
}): MembershipResult {
  const result = leaveMember(input)
  return {
    ...result,
    events: result.events.map((event) =>
      event.type === 'member.left'
        ? { ...event, type: 'member.kicked' as const }
        : event,
    ),
  }
}

export function heartbeatMember(input: {
  roster: LoopRoster
  jid: string
  nowMs?: number
}): MembershipResult {
  const nowMs = input.nowMs ?? Date.now()
  const members = [...input.roster.members]
  const idx = findMemberIndex(members, (m) => m.jid === input.jid && m.lifecycle === 'active')
  if (idx < 0) {
    throw new Error(`Active member not found: ${input.jid}`)
  }
  const member = members[idx]
  members[idx] = {
    ...member,
    lastSeenAt: isoNow(nowMs),
    show: member.paused ? 'DND' : 'ONLINE',
  }
  return {
    roster: touchRoster({ ...input.roster, members }, nowMs),
    events: [{ type: 'member.heartbeat', at: isoNow(nowMs), jid: input.jid }],
  }
}

export function rejoinMember(input: {
  roster: LoopRoster
  vision?: CollabVision
  jid: string
  slot: string
  mode: 'resume' | 'replace'
  nowMs?: number
}): MembershipResult {
  const nowMs = input.nowMs ?? Date.now()
  const members = [...input.roster.members]
  const idx = findMemberIndex(members, (m) => m.slot === input.slot)
  if (idx < 0) {
    throw new Error(`Slot not found: ${input.slot}`)
  }
  const slotMember = members[idx]
  const events: CollabEvent[] = []

  if (input.mode === 'resume') {
    if (slotMember.jid !== input.jid) {
      throw new Error(`Resume requires same jid on slot ${input.slot}`)
    }
    if (slotMember.lifecycle !== 'active' || slotMember.show !== 'OFFLINE') {
      throw new Error(`Member ${input.jid} is not offline for resume`)
    }
    const epoch = slotMember.epoch + 1
    members[idx] = {
      ...slotMember,
      lifecycle: 'active',
      show: 'ONLINE',
      lastSeenAt: isoNow(nowMs),
      leftAt: undefined,
      epoch,
      paused: false,
    }
  } else {
    if (slotMember.lifecycle === 'active' && slotMember.jid && slotMember.jid !== input.jid) {
      const oldJid = slotMember.jid
      members[idx] = {
        ...slotMember,
        lifecycle: 'left',
        show: 'OFFLINE',
        leftAt: isoNow(nowMs),
        epoch: slotMember.epoch + 1,
        paused: false,
      }
      events.push({ type: 'member.left', at: isoNow(nowMs), jid: oldJid, slot: input.slot })
    }
    const kind = rosterPeerKindFromJid(input.jid)
    const epoch = (slotMember.epoch ?? 0) + 1
    members[idx] = {
      ...slotMember,
      jid: parseJid(input.jid).full,
      kind,
      lifecycle: 'active',
      show: 'ONLINE',
      lastSeenAt: isoNow(nowMs),
      joinedAt: isoNow(nowMs),
      leftAt: undefined,
      epoch,
      paused: false,
    }
  }

  events.push({
    type: 'member.rejoined',
    at: isoNow(nowMs),
    jid: input.jid,
    slot: input.slot,
    detail: input.mode,
  })

  let vision = input.vision
  const visionEvents: CollabEvent[] = []
  if (vision) {
    const claimed = claimOrphanedGoals(vision, input.jid, input.slot, nowMs)
    vision = claimed.vision
    visionEvents.push(...claimed.events)
  }

  return {
    roster: touchRoster({ ...input.roster, members }, nowMs),
    vision,
    events: [...events, ...visionEvents],
  }
}

export function inviteMember(input: {
  roster: LoopRoster
  slot: string
  role: string
  kind?: PeerKind
  nowMs?: number
}): MembershipResult {
  const nowMs = input.nowMs ?? Date.now()
  const kind = input.kind ?? 'session'
  const members = [...input.roster.members]
  let idx = findMemberIndex(members, (m) => m.slot === input.slot)
  if (idx < 0) {
    members.push({
      kind,
      slot: input.slot,
      role: input.role,
      lifecycle: 'vacant',
      epoch: 0,
    })
    idx = members.length - 1
  } else {
    const existing = members[idx]
    if (existing.lifecycle !== 'vacant' && existing.lifecycle !== 'left') {
      throw new Error(`Slot ${input.slot} is not vacant`)
    }
    members[idx] = {
      ...existing,
      kind,
      role: input.role,
      lifecycle: 'vacant',
      jid: undefined,
      show: undefined,
      lastSeenAt: undefined,
      joinedAt: undefined,
      leftAt: undefined,
      paused: false,
    }
  }

  return {
    roster: touchRoster({ ...input.roster, members }, nowMs),
    events: [{
      type: 'member.invited',
      at: isoNow(nowMs),
      slot: input.slot,
      detail: input.role,
    }],
  }
}

export function pauseMember(input: {
  roster: LoopRoster
  jid: string
  nowMs?: number
}): MembershipResult {
  const nowMs = input.nowMs ?? Date.now()
  const members = [...input.roster.members]
  const idx = findMemberIndex(members, (m) => m.jid === input.jid && m.lifecycle === 'active')
  if (idx < 0) {
    throw new Error(`Active member not found: ${input.jid}`)
  }
  members[idx] = { ...members[idx], paused: true, show: 'DND' }
  return {
    roster: touchRoster({ ...input.roster, members }, nowMs),
    events: [{ type: 'member.paused', at: isoNow(nowMs), jid: input.jid }],
  }
}

export function resumeMember(input: {
  roster: LoopRoster
  jid: string
  nowMs?: number
}): MembershipResult {
  const nowMs = input.nowMs ?? Date.now()
  const members = [...input.roster.members]
  const idx = findMemberIndex(members, (m) => m.jid === input.jid && m.lifecycle === 'active')
  if (idx < 0) {
    throw new Error(`Active member not found: ${input.jid}`)
  }
  members[idx] = {
    ...members[idx],
    paused: false,
    show: 'ONLINE',
    lastSeenAt: isoNow(nowMs),
  }
  return {
    roster: touchRoster({ ...input.roster, members }, nowMs),
    events: [{ type: 'member.resumed', at: isoNow(nowMs), jid: input.jid }],
  }
}

/** After leave/kick, free the slot for a future join */
export function freeVacantSlot(roster: LoopRoster, slot: string, nowMs?: number): LoopRoster {
  const now = nowMs ?? Date.now()
  const members = roster.members.map((member) => {
    if (member.slot === slot && member.lifecycle === 'left') {
      return {
        kind: member.kind,
        slot: member.slot,
        role: member.role,
        lifecycle: 'vacant' as const,
        epoch: member.epoch,
      }
    }
    return member
  })
  return touchRoster({ ...roster, members }, now)
}
