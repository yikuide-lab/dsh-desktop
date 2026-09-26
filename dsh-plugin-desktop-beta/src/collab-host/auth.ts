/** Admin / grant authorization for Collab HTTP ops. */

import {
  ensureSecret,
  readAdminJson,
  readRosterJson,
  verifyCapToken,
  type CapToken,
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
])

const ADMIN_WRITE_OPS = new Set<DesktopCollabOp>([
  'loop.start',
  'loop.close',
  'membership.invite',
  'membership.kick',
  'goals.reassign',
  'peer.pause',
  'peer.resume',
  'admin.transfer',
  'healer.apply',
  'healer.evaluate',
  'plan.evaluate',
  'plan.assign',
  'plan.spawnBranch',
  'grants.issue',
  'vision.append',
  'bus.send',
])

const MEMBER_SELF_OPS = new Set<DesktopCollabOp>([
  'membership.join',
  'membership.leave',
  'membership.heartbeat',
  'membership.rejoin',
])

export function isReadOp(op: DesktopCollabOp): boolean {
  return READ_OPS.has(op)
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

export async function authorizeCollabOp(input: {
  op: DesktopCollabOp
  loopId?: string
  actorJid?: string
  capToken?: CapToken
  targetJid?: string
}): Promise<string | undefined> {
  if (isReadOp(input.op)) return undefined

  if (MEMBER_SELF_OPS.has(input.op)) {
    if (!input.actorJid) return 'actorJid is required'
    const target = input.targetJid ?? input.actorJid
    if (input.actorJid === target) return undefined
    if (await hasAdminControl(input)) return undefined
    return 'forbidden: member self-service requires matching actorJid'
  }

  if (ADMIN_WRITE_OPS.has(input.op)) {
    if (!input.actorJid && !input.capToken) return 'actorJid or capToken is required'
    if (await hasAdminControl(input)) return undefined
    return 'forbidden: admin control required'
  }

  return 'forbidden'
}
