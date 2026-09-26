/** Admin / deputy / grant authorization for Collab HTTP ops. */

import {
  ensureSecret,
  readAdminJson,
  readRosterJson,
  verifyCapToken,
  type CapToken,
  type DeputyGrant,
  type LoopAdmin,
} from 'dsh-plugin-workflow/collab'
import type { DesktopCollabOp } from '../desktop-collab-contract.ts'

export const DEFAULT_ADMIN_JID = 'admin@desktop.local/control'

const READ_OPS = new Set<DesktopCollabOp>([
  'loop.get',
  'vision.get',
  'roster.get',
  'network.snapshot',
  'healer.pending',
  'plan.get',
  'asp.status',
])

const ADMIN_ONLY_OPS = new Set<DesktopCollabOp>([
  'loop.start',
  'loop.close',
  'admin.transfer',
  'admin.updateControl',
  'vision.append',
  'bus.send',
  'grants.issue',
  'plan.assign',
  'asp.setMode',
])

const OP_TO_GRANT: Partial<Record<DesktopCollabOp, DeputyGrant>> = {
  'membership.invite': 'invite',
  'membership.kick': 'kick',
  'goals.reassign': 'reassign',
  'peer.pause': 'pause',
  'peer.resume': 'pause',
  'plan.spawnBranch': 'spawnBranch',
  'healer.apply': 'healApply',
  'healer.evaluate': 'healEvaluate',
  'plan.evaluate': 'planEvaluate',
}

const MEMBER_SELF_OPS = new Set<DesktopCollabOp>([
  'membership.join',
  'membership.leave',
  'membership.heartbeat',
  'membership.rejoin',
])

export function isReadOp(op: DesktopCollabOp): boolean {
  return READ_OPS.has(op)
}

function defaultDeputyGrants(admin: LoopAdmin, deputyJid: string): DeputyGrant[] {
  const explicit = admin.deputyGrants?.[deputyJid]
  if (explicit?.length) return explicit
  if (admin.deputies?.includes(deputyJid)) return ['read']
  return []
}

function deputyHasGrant(admin: LoopAdmin, deputyJid: string, grant: DeputyGrant): boolean {
  return defaultDeputyGrants(admin, deputyJid).includes(grant)
}

async function memberEpoch(loopId: string, subjectJid: string): Promise<number> {
  const roster = await readRosterJson(loopId)
  const member = roster.members.find((entry) => entry.jid === subjectJid)
  return member?.epoch ?? 0
}

export async function hasAdminControl(input: {
  loopId?: string
  actorJid?: string
  capToken?: CapToken
  adminJid?: string
}): Promise<boolean> {
  const adminJid = input.loopId
    ? (await readAdminJson(input.loopId)).adminJid
    : (input.adminJid ?? DEFAULT_ADMIN_JID)
  if (input.actorJid && input.actorJid === adminJid) return true
  if (!input.capToken || !input.loopId) return false
  const secret = await ensureSecret()
  const epoch = await memberEpoch(input.loopId, input.capToken.subject_jid)
  return verifyCapToken({
    token: input.capToken,
    secret,
    loopId: input.loopId,
    subject_jid: input.capToken.subject_jid,
    requiredPermissions: ['admin:control'],
    expectedEpoch: epoch,
  })
}

async function hasDeputyGrant(input: {
  loopId: string
  actorJid: string
  grant: DeputyGrant
}): Promise<boolean> {
  const admin = await readAdminJson(input.loopId)
  if (admin.adminJid === input.actorJid) return true
  if (!admin.deputies?.includes(input.actorJid)) return false
  return deputyHasGrant(admin, input.actorJid, input.grant)
}

export async function authorizeCollabOp(input: {
  op: DesktopCollabOp
  loopId?: string
  actorJid?: string
  capToken?: CapToken
  targetJid?: string
}): Promise<string | undefined> {
  if (input.op === 'asp.status' || input.op === 'asp.setMode') {
    if (input.op === 'asp.setMode') {
      if (!input.actorJid || input.actorJid !== DEFAULT_ADMIN_JID) {
        if (!input.loopId || !(await hasAdminControl(input))) {
          return 'forbidden: admin control required'
        }
      }
    }
    return undefined
  }

  if (isReadOp(input.op)) {
    if (!input.loopId || !input.actorJid) return undefined
    const admin = await readAdminJson(input.loopId)
    if (admin.adminJid === input.actorJid) return undefined
    if (admin.deputies?.includes(input.actorJid)) {
      if (deputyHasGrant(admin, input.actorJid, 'read')) return undefined
      return 'forbidden: deputy read grant required'
    }
    return undefined
  }

  if (MEMBER_SELF_OPS.has(input.op)) {
    if (!input.actorJid) return 'actorJid is required'
    const target = input.targetJid ?? input.actorJid
    if (input.actorJid === target) return undefined
    if (await hasAdminControl(input)) return undefined
    return 'forbidden: member self-service requires matching actorJid'
  }

  if (ADMIN_ONLY_OPS.has(input.op)) {
    if (!input.actorJid && !input.capToken) return 'actorJid or capToken is required'
    if (await hasAdminControl(input)) return undefined
    return 'forbidden: admin control required'
  }

  const grant = OP_TO_GRANT[input.op]
  if (grant) {
    if (!input.loopId) return 'loopId is required'
    if (!input.actorJid && !input.capToken) return 'actorJid or capToken is required'
    if (await hasAdminControl(input)) return undefined
    if (input.actorJid && await hasDeputyGrant({
      loopId: input.loopId,
      actorJid: input.actorJid,
      grant,
    })) {
      return undefined
    }
    return `forbidden: deputy grant "${grant}" required`
  }

  return 'forbidden'
}
