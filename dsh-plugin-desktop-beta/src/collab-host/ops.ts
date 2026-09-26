/** Collab Loop HTTP op dispatch — pure store mutations + workflow collab helpers. */

import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import {
  applyHealActions,
  applyTaskPlanPriority,
  createLoopDir,
  ensureCollabRoot,
  ensureSecret,
  freeVacantSlot,
  issueCapToken,
  joinMember,
  kickMember,
  leaveMember,
  heartbeatMember,
  inviteMember,
  pauseMember,
  rejoinMember,
  resumeMember,
  parseHealPlan,
  parseTaskPlan,
  readAdminJson,
  readBranchesIndex,
  readHealPending,
  readLoopJson,
  readPlanLatest,
  readRosterJson,
  readVisionJson,
  validateHealPlan,
  validateTaskPlan,
  writeAdminJson,
  writeBranchesIndex,
  writeHealPending,
  writeLoopJson,
  writeBranchYaml,
  writePlanLatest,
  writeRosterJson,
  writeVisionJson,
  type BranchRecord,
  type CapToken,
  type CollabGoal,
  type CollabLoop,
  type CollabPayload,
  type CollabVision,
  type HealPlan,
  type LoopAdmin,
  type LoopRoster,
  type PeerKind,
  type TaskPlan,
} from 'dsh-plugin-workflow/collab'
import type { DesktopCollabRequest } from '../desktop-collab-contract.ts'
import {
  authorizeCollabOp,
  DEFAULT_ADMIN_JID,
} from './auth.ts'
import { getAspBridgeStatus, getCollabBus, setAspBridgeMode } from './bus.ts'
import {
  evaluateHealWithLlm,
  evaluateTaskPlanWithLlm,
  heuristicHealEvaluate,
  heuristicTaskPlan,
} from './llm.ts'
import { loadNetworkSnapshot } from './tick.ts'

function isoNow(): string {
  return new Date().toISOString()
}

function requireLoopId(body: DesktopCollabRequest): string | undefined {
  return typeof body.loopId === 'string' && body.loopId.trim() ? body.loopId.trim() : undefined
}

async function persistMembershipResult(
  loopId: string,
  roster: LoopRoster,
  vision?: CollabVision,
): Promise<void> {
  await writeRosterJson(loopId, roster)
  if (vision) await writeVisionJson(loopId, vision)
}

function reassignGoalInVision(
  vision: CollabVision,
  goalId: string,
  toJid: string | undefined,
  toSlot: string | undefined,
): CollabVision {
  const goals = vision.goals.map((goal) => {
    if (goal.id !== goalId) return goal
    const next: CollabGoal = { ...goal, status: 'open' }
    if (toJid !== undefined) next.ownerJid = toJid
    else delete next.ownerJid
    if (toSlot !== undefined) next.slot = toSlot
    return next
  })
  return { ...vision, goals, updatedAt: isoNow() }
}

async function loadVision(loopId: string): Promise<CollabVision | undefined> {
  try {
    return await readVisionJson(loopId)
  } catch {
    return undefined
  }
}

function sanitizeWorkflowName(name: string): string {
  const trimmed = name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return trimmed || 'collab-branch'
}

function buildBranchWorkflowYaml(workflowName: string, hint: string): string {
  const title = hint.trim().replace(/\n/g, ' ').slice(0, 120)
  return `apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: ${sanitizeWorkflowName(workflowName)}
  title: ${JSON.stringify(title)}
spec:
  steps:
    - id: echo-hint
      type: script
      run: |
        echo ${JSON.stringify(`Collab branch: ${hint.trim()}`)}
    - id: summarize
      type: llm
      deps: [echo-hint]
      prompt: |
        Summarize progress for this collab branch task:
        ${hint.trim()}
      role: summary
`
}

/** Execute one Collab HTTP op. */
export async function executeCollabOp(
  body: DesktopCollabRequest,
  ctx?: Context,
): Promise<object> {
  const loopId = requireLoopId(body)
  const capToken = body.capToken as CapToken | undefined

  const authInput: Parameters<typeof authorizeCollabOp>[0] = { op: body.op }
  const authLoopId = loopId ?? body.loopId
  if (authLoopId !== undefined) authInput.loopId = authLoopId
  if (body.actorJid !== undefined) authInput.actorJid = body.actorJid
  if (capToken !== undefined) authInput.capToken = capToken
  if (body.jid !== undefined) authInput.targetJid = body.jid
  const authError = await authorizeCollabOp(authInput)
  if (authError) return { ok: false, error: authError }

  if (body.op === 'asp.status') {
    return { ok: true, status: getAspBridgeStatus() }
  }

  if (body.op === 'asp.setMode') {
    const mode = body.aspMode ?? 'in-process'
    if (mode !== 'in-process' && mode !== 'disconnected' && mode !== 'external') {
      return { ok: false, error: 'aspMode must be in-process, disconnected, or external' }
    }
    const result = setAspBridgeMode(mode, body.aspEndpoint)
    if ('error' in result) return { ok: false, error: result.error }
    return { ok: true, status: result }
  }

  if (body.op === 'loop.start') {
    if (!body.workflowName?.trim()) return { ok: false, error: 'workflowName is required' }
    await ensureCollabRoot()
    const id = body.loopId?.trim() || randomUUID()
    const adminJid = body.adminJid?.trim() || DEFAULT_ADMIN_JID
    const now = isoNow()
    await createLoopDir(id)
    const loop: CollabLoop = {
      loopId: id,
      workflowName: body.workflowName.trim(),
      status: 'running',
      createdAt: now,
    }
    if (body.rootRunId !== undefined) loop.rootRunId = body.rootRunId
    const admin: LoopAdmin = {
      loopId: id,
      adminJid,
      control: {
        canInvite: true,
        canKick: true,
        canReassignGoals: true,
        canSpawnBranch: true,
        canPausePeers: true,
        canHealAuto: false,
        allowRemotePeers: false,
      },
      healerIntervalMs: 60_000,
    }
    const roster: LoopRoster = {
      loopId: id,
      members: [],
      updatedAt: now,
    }
    const vision: CollabVision = {
      loopId: id,
      threadId: id,
      goals: [],
      facts: [],
      artifacts: [],
      updatedAt: now,
    }
    await writeLoopJson(id, loop)
    await writeAdminJson(id, admin)
    await writeRosterJson(id, roster)
    await writeVisionJson(id, vision)
    await writeBranchesIndex(id, [])
    await writeHealPending(id, null)
    return { ok: true, loop, admin, roster, vision }
  }

  if (!loopId) return { ok: false, error: 'loopId is required' }

  if (body.op === 'loop.get') {
    const loop = await readLoopJson(loopId)
    return { ok: true, loop }
  }

  if (body.op === 'loop.close') {
    const loop = await readLoopJson(loopId)
    if (loop.status === 'closed') return { ok: true, loop }
    const closed = { ...loop, status: 'closed' as const, closedAt: isoNow() }
    await writeLoopJson(loopId, closed)
    return { ok: true, loop: closed }
  }

  if (body.op === 'vision.get') {
    const vision = await readVisionJson(loopId)
    return { ok: true, vision }
  }

  if (body.op === 'vision.append') {
    const vision = await readVisionJson(loopId)
    const next = { ...vision, updatedAt: isoNow() }
    if (body.goals?.length) {
      next.goals = [
        ...next.goals,
        ...body.goals.map((goal) => {
          const entry: CollabGoal = {
            id: goal.id,
            title: goal.title,
            status: (goal.status ?? 'open') as CollabGoal['status'],
          }
          if (goal.ownerJid !== undefined) entry.ownerJid = goal.ownerJid
          if (goal.slot !== undefined) entry.slot = goal.slot
          return entry
        }),
      ]
    }
    if (body.facts?.length) {
      next.facts = [
        ...next.facts,
        ...body.facts.map((fact) => ({
          id: fact.id ?? randomUUID(),
          text: fact.text,
          sourceJid: fact.sourceJid,
          at: isoNow(),
        })),
      ]
    }
    if (body.artifacts?.length) {
      next.artifacts = [
        ...next.artifacts,
        ...body.artifacts.map((artifact) => ({
          id: artifact.id ?? randomUUID(),
          pathOrUri: artifact.pathOrUri,
          kind: artifact.kind,
          sourceJid: artifact.sourceJid,
        })),
      ]
    }
    await writeVisionJson(loopId, next)
    return { ok: true, vision: next }
  }

  if (body.op === 'roster.get') {
    const roster = await readRosterJson(loopId)
    return { ok: true, roster }
  }

  if (body.op === 'membership.join') {
    if (!body.jid || !body.slot) return { ok: false, error: 'jid and slot are required' }
    const roster = await readRosterJson(loopId)
    const vision = await loadVision(loopId)
    const joinInput: Parameters<typeof joinMember>[0] = {
      roster,
      jid: body.jid,
      slot: body.slot,
    }
    if (vision !== undefined) joinInput.vision = vision
    if (body.boundStepId !== undefined) joinInput.boundStepId = body.boundStepId
    const result = joinMember(joinInput)
    await persistMembershipResult(loopId, result.roster, result.vision)
    return { ok: true, ...result }
  }

  if (body.op === 'membership.leave') {
    if (!body.jid) return { ok: false, error: 'jid is required' }
    const roster = await readRosterJson(loopId)
    const vision = await loadVision(loopId)
    const leaveInput: Parameters<typeof leaveMember>[0] = { roster, jid: body.jid }
    if (vision !== undefined) leaveInput.vision = vision
    const result = leaveMember(leaveInput)
    const member = result.roster.members.find((entry) => entry.jid === body.jid)
    const freed = member?.slot
      ? freeVacantSlot(result.roster, member.slot)
      : result.roster
    await persistMembershipResult(loopId, freed, result.vision)
    return { ok: true, roster: freed, vision: result.vision, events: result.events }
  }

  if (body.op === 'membership.heartbeat') {
    if (!body.jid) return { ok: false, error: 'jid is required' }
    const roster = await readRosterJson(loopId)
    const result = heartbeatMember({ roster, jid: body.jid })
    await writeRosterJson(loopId, result.roster)
    return { ok: true, ...result }
  }

  if (body.op === 'membership.rejoin') {
    if (!body.jid || !body.slot || !body.mode) {
      return { ok: false, error: 'jid, slot, and mode are required' }
    }
    const roster = await readRosterJson(loopId)
    const vision = await loadVision(loopId)
    const rejoinInput: Parameters<typeof rejoinMember>[0] = {
      roster,
      jid: body.jid,
      slot: body.slot,
      mode: body.mode,
    }
    if (vision !== undefined) rejoinInput.vision = vision
    const result = rejoinMember(rejoinInput)
    await persistMembershipResult(loopId, result.roster, result.vision)
    return { ok: true, ...result }
  }

  if (body.op === 'membership.invite') {
    if (!body.slot || !body.role) return { ok: false, error: 'slot and role are required' }
    const roster = await readRosterJson(loopId)
    const inviteInput: Parameters<typeof inviteMember>[0] = {
      roster,
      slot: body.slot,
      role: body.role,
    }
    if (body.kind !== undefined) inviteInput.kind = body.kind as PeerKind
    const result = inviteMember(inviteInput)
    await writeRosterJson(loopId, result.roster)
    return { ok: true, ...result }
  }

  if (body.op === 'membership.kick') {
    if (!body.jid) return { ok: false, error: 'jid is required' }
    const roster = await readRosterJson(loopId)
    const vision = await loadVision(loopId)
    const kickInput: Parameters<typeof kickMember>[0] = { roster, jid: body.jid }
    if (vision !== undefined) kickInput.vision = vision
    const result = kickMember(kickInput)
    const member = result.roster.members.find((entry) => entry.jid === body.jid)
    const freed = member?.slot
      ? freeVacantSlot(result.roster, member.slot)
      : result.roster
    await persistMembershipResult(loopId, freed, result.vision)
    return { ok: true, roster: freed, vision: result.vision, events: result.events }
  }

  if (body.op === 'network.snapshot') {
    const snapshot = await loadNetworkSnapshot(loopId)
    return { ok: true, snapshot }
  }

  if (body.op === 'goals.reassign') {
    if (!body.goalId) return { ok: false, error: 'goalId is required' }
    const vision = await readVisionJson(loopId)
    const next = reassignGoalInVision(vision, body.goalId, body.toJid, body.toSlot)
    await writeVisionJson(loopId, next)
    return { ok: true, vision: next }
  }

  if (body.op === 'peer.pause') {
    if (!body.jid) return { ok: false, error: 'jid is required' }
    const roster = await readRosterJson(loopId)
    const result = pauseMember({ roster, jid: body.jid })
    await writeRosterJson(loopId, result.roster)
    return { ok: true, ...result }
  }

  if (body.op === 'peer.resume') {
    if (!body.jid) return { ok: false, error: 'jid is required' }
    const roster = await readRosterJson(loopId)
    const result = resumeMember({ roster, jid: body.jid })
    await writeRosterJson(loopId, result.roster)
    return { ok: true, ...result }
  }

  if (body.op === 'admin.transfer') {
    if (!body.jid) return { ok: false, error: 'jid is required' }
    const admin = await readAdminJson(loopId)
    const next = { ...admin, adminJid: body.jid }
    await writeAdminJson(loopId, next)
    return { ok: true, admin: next }
  }

  if (body.op === 'admin.updateControl') {
    const admin = await readAdminJson(loopId)
    const next: LoopAdmin = {
      ...admin,
      control: {
        ...admin.control,
        ...(body.control ?? {}),
      },
    }
    if (body.deputies !== undefined) next.deputies = body.deputies
    if (body.deputyGrants !== undefined) next.deputyGrants = body.deputyGrants
    await writeAdminJson(loopId, next)
    return { ok: true, admin: next }
  }

  if (body.op === 'healer.pending') {
    let pending = null
    try {
      pending = await readHealPending(loopId)
    } catch {
      pending = null
    }
    return { ok: true, pending }
  }

  if (body.op === 'healer.evaluate') {
    const snapshot = await loadNetworkSnapshot(loopId)
    let plan: HealPlan
    let source: 'ai' | 'heuristic' = 'heuristic'
    if (ctx) {
      const llmPlan = await evaluateHealWithLlm(ctx, snapshot)
      if (llmPlan) {
        plan = llmPlan
        source = 'ai'
      } else {
        plan = heuristicHealEvaluate(snapshot)
      }
    } else {
      plan = heuristicHealEvaluate(snapshot)
    }
    validateHealPlan(plan)
    await writeHealPending(loopId, plan)
    return { ok: true, plan, source }
  }

  if (body.op === 'healer.apply') {
    if (!body.healPlan) return { ok: false, error: 'healPlan is required' }
    const plan = parseHealPlan(body.healPlan)
    validateHealPlan(plan)
    const roster = await readRosterJson(loopId)
    const vision = await loadVision(loopId)
    const healInput: Parameters<typeof applyHealActions>[0] = { plan, roster }
    if (vision !== undefined) healInput.vision = vision
    const result = applyHealActions(healInput)
    if (result.roster) await writeRosterJson(loopId, result.roster)
    if (result.vision) await writeVisionJson(loopId, result.vision)
    await writeHealPending(loopId, null)
    return { ok: true, ...result }
  }

  if (body.op === 'plan.get') {
    try {
      const plan = await readPlanLatest(loopId)
      return { ok: true, plan }
    } catch {
      return { ok: true, plan: null }
    }
  }

  if (body.op === 'plan.evaluate') {
    if (body.taskPlan) {
      const plan = parseTaskPlan(body.taskPlan)
      validateTaskPlan(plan)
      await writePlanLatest(loopId, plan)
      return { ok: true, plan, source: 'manual' }
    }
    const hint = body.hint?.trim() || body.title?.trim()
    if (!hint) return { ok: false, error: 'taskPlan or hint is required' }
    const vision = await loadVision(loopId)
    let plan: TaskPlan
    let source: 'ai' | 'heuristic' = 'heuristic'
    if (ctx) {
      const llmPlan = await evaluateTaskPlanWithLlm(ctx, loopId, hint, vision)
      if (llmPlan) {
        plan = llmPlan
        source = 'ai'
      } else {
        plan = heuristicTaskPlan(loopId, hint, vision)
      }
    } else {
      plan = heuristicTaskPlan(loopId, hint, vision)
    }
    validateTaskPlan(plan)
    await writePlanLatest(loopId, plan)
    return { ok: true, plan, source }
  }

  if (body.op === 'plan.assign') {
    let plan
    try {
      plan = await readPlanLatest(loopId)
    } catch {
      return { ok: false, error: 'no task plan; run plan.evaluate first' }
    }
    const roster = await readRosterJson(loopId)
    const vision = await loadVision(loopId)
    let branches: BranchRecord[] = []
    try {
      branches = await readBranchesIndex(loopId)
    } catch {
      branches = []
    }
    const planInput: Parameters<typeof applyTaskPlanPriority>[0] = { plan, roster, branches }
    if (vision !== undefined) planInput.vision = vision
    const result = applyTaskPlanPriority(planInput)
    if (result.roster) await writeRosterJson(loopId, result.roster)
    if (result.vision) await writeVisionJson(loopId, result.vision)
    if (result.branches) await writeBranchesIndex(loopId, result.branches)
    return { ok: true, ...result }
  }

  if (body.op === 'plan.spawnBranch') {
    if (!body.branchId || !body.hint) {
      return { ok: false, error: 'branchId and hint are required' }
    }
    const branches = await readBranchesIndex(loopId)
    const workflowName = body.workflowName?.trim() || `${body.hint}-${body.branchId}`
    const record: BranchRecord = {
      branchId: body.branchId,
      loopId,
      goalIds: body.goals?.map((goal) => goal.id) ?? (body.goalId ? [body.goalId] : []),
      workflowName,
      parentLoopId: loopId,
      status: 'draft',
      createdAt: isoNow(),
    }
    const yamlPath = await writeBranchYaml(
      loopId,
      body.branchId,
      buildBranchWorkflowYaml(workflowName, body.hint),
    )
    const next = [...branches, record]
    await writeBranchesIndex(loopId, next)
    return { ok: true, branch: record, branches: next, yamlPath }
  }

  if (body.op === 'bus.send') {
    if (!body.from_jid || !body.to_jid || !body.payload) {
      return { ok: false, error: 'from_jid, to_jid, and payload are required' }
    }
    const envelope = getCollabBus().send({
      from_jid: body.from_jid,
      to_jid: body.to_jid,
      payload: body.payload as CollabPayload,
    })
    return { ok: true, envelope }
  }

  if (body.op === 'grants.issue') {
    if (!body.jid) return { ok: false, error: 'jid is required' }
    const roster = await readRosterJson(loopId)
    const member = roster.members.find((entry) => entry.jid === body.jid)
    if (!member) return { ok: false, error: 'member not found' }
    const secret = await ensureSecret()
    const permissions = body.permissions?.length ? body.permissions : ['vision:read']
    const tokenInput: Parameters<typeof issueCapToken>[0] = {
      loopId,
      subject_jid: body.jid,
      permissions,
      epoch: member.epoch,
      secret,
    }
    if (body.ttlMs !== undefined) tokenInput.ttlMs = body.ttlMs
    const token = issueCapToken(tokenInput)
    return { ok: true, token }
  }

  return { ok: false, error: 'unknown op' }
}
