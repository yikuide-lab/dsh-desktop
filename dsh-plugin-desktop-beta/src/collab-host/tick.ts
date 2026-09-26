/** Stability + healer background ticks for active Collab loops. */

import type { Context } from '@deepseek-ai/cordis'
import { readdir } from 'node:fs/promises'
import {
  applyHealActions,
  isLowRiskHealAction,
  readAdminJson,
  readBranchesIndex,
  readHealPending,
  readLoopJson,
  readRosterJson,
  readVisionJson,
  resolveCollabRoot,
  tick as stabilityTick,
  writeHealPending,
  writeRosterJson,
  writeVisionJson,
  type CollabLoop,
} from 'dsh-plugin-workflow/collab'
import { evaluateHealWithLlm, heuristicHealEvaluate } from './llm.ts'

const ACTIVE_STATUSES = new Set<CollabLoop['status']>(['running', 'waiting'])

export async function listActiveLoops(): Promise<CollabLoop[]> {
  const root = resolveCollabRoot()
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return []
  }
  const loops: CollabLoop[] = []
  for (const entry of entries) {
    if (entry === 'secret') continue
    try {
      const loop = await readLoopJson(entry)
      if (ACTIVE_STATUSES.has(loop.status)) loops.push(loop)
    } catch {
      // skip non-loop directories
    }
  }
  return loops
}

export async function runStabilityPass(nowMs = Date.now()): Promise<void> {
  const loops = await listActiveLoops()
  for (const loop of loops) {
    try {
      const roster = await readRosterJson(loop.loopId)
      let vision
      try {
        vision = await readVisionJson(loop.loopId)
      } catch {
        vision = undefined
      }
      const result = stabilityTick(roster, vision, nowMs)
      await writeRosterJson(loop.loopId, result.roster)
      if (result.vision) await writeVisionJson(loop.loopId, result.vision)
    } catch {
      // best-effort per loop
    }
  }
}

export async function runHealerPassForLoop(
  loopId: string,
  nowMs = Date.now(),
  ctx?: Context,
): Promise<void> {
  const admin = await readAdminJson(loopId)
  const interval = admin.healerIntervalMs ?? 60_000
  if (interval <= 0) return

  const roster = await readRosterJson(loopId)
  let vision
  try {
    vision = await readVisionJson(loopId)
  } catch {
    vision = undefined
  }

  const snapshot = await loadNetworkSnapshot(loopId)
  let plan
  if (ctx) {
    const llmPlan = await evaluateHealWithLlm(ctx, snapshot)
    plan = llmPlan ?? heuristicHealEvaluate(snapshot)
  } else {
    plan = heuristicHealEvaluate(snapshot)
  }
  await writeHealPending(loopId, plan)

  if (admin.control.canHealAuto) {
    const autoActions = plan.actions.filter(isLowRiskHealAction)
    if (autoActions.length > 0) {
      const healInput: Parameters<typeof applyHealActions>[0] = {
        plan: { ...plan, actions: autoActions },
        roster,
        nowMs,
      }
      if (vision !== undefined) healInput.vision = vision
      const applied = applyHealActions(healInput)
      if (applied.roster) await writeRosterJson(loopId, applied.roster)
      if (applied.vision) await writeVisionJson(loopId, applied.vision)
    }
  }
}

export async function runHealerPass(nowMs = Date.now(), ctx?: Context): Promise<void> {
  const loops = await listActiveLoops()
  for (const loop of loops) {
    try {
      await runHealerPassForLoop(loop.loopId, nowMs, ctx)
    } catch {
      // best-effort per loop
    }
  }
}

export async function loadNetworkSnapshot(loopId: string): Promise<object> {
  const loop = await readLoopJson(loopId)
  const admin = await readAdminJson(loopId)
  const roster = await readRosterJson(loopId)
  let vision
  try {
    vision = await readVisionJson(loopId)
  } catch {
    vision = undefined
  }
  let branches: unknown[] = []
  try {
    branches = await readBranchesIndex(loopId)
  } catch {
    branches = []
  }
  let pendingHeal = null
  try {
    pendingHeal = await readHealPending(loopId)
  } catch {
    pendingHeal = null
  }
  const offlineCount = roster.members.filter(
    (member) => member.lifecycle === 'active' && member.show === 'OFFLINE',
  ).length
  const healthScore = Math.max(0, 100 - offlineCount * 25)
  return {
    loop,
    admin,
    roster,
    vision,
    branches,
    pendingHeal,
    healthScore,
  }
}
