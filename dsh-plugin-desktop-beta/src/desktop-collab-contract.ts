/** Contract for the private Desktop Collab Loop HTTP bridge. */

export const DESKTOP_COLLAB_PATH = '/api/desktop/collab'

export type DesktopCollabOp =
  | 'loop.start'
  | 'loop.close'
  | 'loop.get'
  | 'vision.get'
  | 'vision.append'
  | 'roster.get'
  | 'membership.join'
  | 'membership.leave'
  | 'membership.heartbeat'
  | 'membership.rejoin'
  | 'membership.invite'
  | 'membership.kick'
  | 'network.snapshot'
  | 'goals.reassign'
  | 'peer.pause'
  | 'peer.resume'
  | 'admin.transfer'
  | 'healer.evaluate'
  | 'healer.apply'
  | 'healer.pending'
  | 'plan.evaluate'
  | 'plan.assign'
  | 'plan.spawnBranch'
  | 'plan.get'
  | 'bus.send'
  | 'grants.issue'

export interface DesktopCollabRequest {
  readonly op: DesktopCollabOp
  readonly loopId?: string
  readonly actorJid?: string
  readonly workflowName?: string
  readonly rootRunId?: string
  readonly adminJid?: string
  readonly jid?: string
  readonly slot?: string
  readonly role?: string
  readonly boundStepId?: string
  readonly mode?: 'resume' | 'replace'
  readonly kind?: 'session' | 'agent' | 'workflow'
  readonly goalId?: string
  readonly toJid?: string
  readonly toSlot?: string
  readonly title?: string
  readonly acceptance?: string[]
  readonly facts?: { id?: string; text: string; sourceJid: string }[]
  readonly artifacts?: { id?: string; pathOrUri: string; kind: string; sourceJid: string }[]
  readonly goals?: { id: string; title: string; status?: string; ownerJid?: string; slot?: string }[]
  readonly permissions?: string[]
  readonly capToken?: {
    loopId: string
    subject_jid: string
    permissions: string[]
    issued_at: string
    expires_at: string
    epoch: number
    signature: string
  }
  readonly healPlan?: unknown
  readonly taskPlan?: unknown
  readonly branchId?: string
  readonly hint?: string
  readonly from_jid?: string
  readonly to_jid?: string
  readonly payload?: unknown
  readonly ttlMs?: number
}

export interface DesktopCollabErrorResponse {
  readonly ok: false
  readonly error: string
}
