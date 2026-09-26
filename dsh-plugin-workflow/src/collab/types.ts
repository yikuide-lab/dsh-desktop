/** Collab Loop core types — aligned with docs/collab-loop-plan.md */

export type LoopStatus = 'idle' | 'running' | 'waiting' | 'paused' | 'closed'

export interface CollabLoop {
  loopId: string
  workflowName: string
  rootRunId?: string
  status: LoopStatus
  createdAt: string
  closedAt?: string
}

export type PeerKind = 'session' | 'agent' | 'workflow'

export type MemberLifecycle = 'vacant' | 'joining' | 'active' | 'left'

/** ASP Presence show — meaningful only when lifecycle is active */
export type AspShow = 'ONLINE' | 'AWAY' | 'DND' | 'XA' | 'OFFLINE'

export interface RosterMember {
  jid?: string
  kind: PeerKind
  slot?: string
  role?: string
  lifecycle: MemberLifecycle
  show?: AspShow
  lastSeenAt?: string
  joinedAt?: string
  leftAt?: string
  epoch: number
  boundStepId?: string
  paused?: boolean
}

export interface LoopRoster {
  loopId: string
  members: RosterMember[]
  updatedAt: string
}

export type GoalStatus = 'open' | 'done' | 'blocked' | 'orphaned'

export interface CollabGoal {
  id: string
  title: string
  status: GoalStatus
  ownerJid?: string
  slot?: string
  acceptance?: string[]
  branchId?: string
}

export interface CollabVision {
  loopId: string
  threadId: string
  goals: CollabGoal[]
  facts: { id: string; text: string; sourceJid: string; at: string }[]
  artifacts: { id: string; pathOrUri: string; kind: string; sourceJid: string }[]
  updatedAt: string
}

export type DeputyGrant =
  | 'invite'
  | 'kick'
  | 'reassign'
  | 'pause'
  | 'spawnBranch'
  | 'healApply'
  | 'healEvaluate'
  | 'planEvaluate'
  | 'read'

export type HealAutoAllowAction = 'nudge_rejoin' | 'reassign_goal' | 'invite'

export type HealAutoDenyAction = 'isolate' | 'spawn_repair_branch' | 'escalate_admin'

export interface LoopAdmin {
  loopId: string
  adminJid: string
  deputies?: string[]
  /** Per-deputy grants; deputies listed without an entry default to read-only. */
  deputyGrants?: Record<string, DeputyGrant[]>
  control: {
    canInvite: boolean
    canKick: boolean
    canReassignGoals: boolean
    canSpawnBranch: boolean
    canPausePeers: boolean
    canHealAuto: boolean
    /** When true, non-desktop.local session/agent peers may route via AspBridge (V2). */
    allowRemotePeers?: boolean
    /** Low-risk heal actions eligible for auto-apply when canHealAuto is true. */
    healAutoAllow?: HealAutoAllowAction[]
    /** High-risk heal actions that remain manual even when canHealAuto is true. */
    healAutoDeny?: HealAutoDenyAction[]
  }
  healerIntervalMs?: number
}

export type BranchStatus = 'draft' | 'running' | 'done' | 'failed' | 'cancelled'

export interface BranchRecord {
  branchId: string
  loopId: string
  goalIds: string[]
  workflowName: string
  parentLoopId: string
  runId?: string
  status: BranchStatus
  createdAt: string
}

export interface CapToken {
  loopId: string
  subject_jid: string
  permissions: string[]
  issued_at: string
  expires_at: string
  epoch: number
  signature: string
}

export type HealAction =
  | { type: 'nudge_rejoin'; jid: string }
  | { type: 'reassign_goal'; goalId: string; toJid?: string; toSlot?: string }
  | { type: 'invite'; slot: string; role: string; reason: string; kind?: PeerKind }
  | { type: 'isolate'; jid: string; reason: string }
  | { type: 'spawn_repair_branch'; goalIds: string[]; hint: string }
  | { type: 'escalate_admin'; message: string }

export type HealSeverity = 'info' | 'warn' | 'crit'

export interface HealPlan {
  loopId: string
  at: string
  healthScore: number
  findings: { jid?: string; code: string; detail: string; severity: HealSeverity }[]
  actions: HealAction[]
}

export interface TaskPlanSubtask {
  id: string
  title: string
  acceptance?: string[]
  dependsOn?: string[]
  preferredRole?: string
  assignToJid?: string
  inviteSlot?: string
  branchHint?: string
}

export interface TaskPlan {
  loopId: string
  rootGoal: string
  subtasks: TaskPlanSubtask[]
}

/** Bus envelope aligned with AgentStreamMessage */
export interface CollabEnvelope {
  id: string
  from_jid: string
  to_jid: string
  timestamp: string
  payload: CollabPayload
}

export type CollabPayload =
  | { kind: 'message'; body: string; thread_id?: string }
  | { kind: 'presence'; show: AspShow; status?: string }
  | { kind: 'iq'; name: string; data?: unknown }

export type CollabEventType =
  | 'member.joined'
  | 'member.left'
  | 'member.kicked'
  | 'member.paused'
  | 'member.resumed'
  | 'member.invited'
  | 'member.rejoined'
  | 'member.heartbeat'
  | 'member.offline'
  | 'goal.orphaned'
  | 'goal.reassigned'
  | 'goal.opened'
  | 'branch.spawn'
  | 'heal.nudge'
  | 'heal.escalate'

export interface CollabEvent {
  type: CollabEventType
  at: string
  jid?: string
  slot?: string
  goalId?: string
  detail?: string
}

export interface MembershipResult {
  roster: LoopRoster
  vision?: CollabVision
  events: CollabEvent[]
}

export interface StabilityDefaults {
  heartbeatMs: number
  offlineGraceMs: number
}

export interface StabilityResult {
  roster: LoopRoster
  vision?: CollabVision
  events: CollabEvent[]
}

export type HealMutation =
  | { type: 'nudge_rejoin'; jid: string }
  | { type: 'reassign_goal'; goalId: string; toJid?: string; toSlot?: string }
  | { type: 'invite'; slot: string; role: string; reason: string; kind: PeerKind }
  | { type: 'isolate'; jid: string; reason: string }
  | { type: 'spawn_repair_branch'; goalIds: string[]; hint: string }
  | { type: 'escalate_admin'; message: string }

export interface HealApplyResult {
  roster?: LoopRoster
  vision?: CollabVision
  events: CollabEvent[]
  mutations: HealMutation[]
}

export type TaskPlanMutation =
  | { type: 'assign_goal'; goalId: string; toJid: string }
  | { type: 'invite'; slot: string; role: string; kind: PeerKind }
  | { type: 'spawn_branch'; branchId: string; goalIds: string[]; hint: string; workflowName: string }
  | { type: 'open_goal'; goalId: string; title: string; acceptance?: string[] }

export interface TaskPlanApplyResult {
  roster?: LoopRoster
  vision?: CollabVision
  branches?: BranchRecord[]
  events: CollabEvent[]
  mutations: TaskPlanMutation[]
}
