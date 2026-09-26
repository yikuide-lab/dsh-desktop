/** Collab healer/planner LLM helpers with deterministic fallbacks. */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import {
  parseHealPlan,
  parseTaskPlan,
  validateHealPlan,
  validateTaskPlan,
  type CollabVision,
  type HealPlan,
  type LoopRoster,
  type TaskPlan,
} from 'dsh-plugin-workflow/collab'
import { hostServicesFromContext } from '../desktop-workflow-executor.ts'

export interface CollabNetworkSnapshot {
  loop?: { loopId?: string }
  roster?: LoopRoster
  vision?: CollabVision
  healthScore?: number
}

const HEAL_SYSTEM = `You are the NetworkHealer for DSH Desktop Collab Loops.
Given a network snapshot JSON, return ONLY one JSON object:
{ loopId, at (ISO-8601), healthScore (0-100), findings: [{ jid?, code, detail, severity: info|warn|crit }], actions: [...] }
HealAction types: nudge_rejoin { jid }, reassign_goal { goalId, toJid?, toSlot? },
invite { slot, role, reason, kind? }, isolate { jid, reason },
spawn_repair_branch { goalIds, hint }, escalate_admin { message }.
Prefer nudge_rejoin for offline active members before escalating. No markdown fences.`

const PLAN_SYSTEM = `You are the TaskPlanner for DSH Desktop Collab Loops.
Given a goal hint (and optional vision JSON), return ONLY one JSON object:
{ loopId, rootGoal, subtasks: [{ id, title, acceptance?, dependsOn?, preferredRole?, assignToJid?, inviteSlot?, branchHint? }] }
Each subtask may have at most one of assignToJid, inviteSlot, or branchHint.
Use short stable subtask ids. No markdown fences.`

function isoNow(): string {
  return new Date().toISOString()
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const row = JSON.parse(trimmed.slice(start, end + 1)) as unknown
    return typeof row === 'object' && row !== null && !Array.isArray(row)
      ? row as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function loopIdFromSnapshot(snapshot: CollabNetworkSnapshot): string {
  return snapshot.loop?.loopId?.trim()
    || snapshot.roster?.loopId?.trim()
    || snapshot.vision?.loopId?.trim()
    || ''
}

/** Deterministic heal plan when Host LLM is unavailable. */
export function heuristicHealEvaluate(snapshot: CollabNetworkSnapshot): HealPlan {
  const loopId = loopIdFromSnapshot(snapshot)
  const roster = snapshot.roster ?? { loopId, members: [], updatedAt: isoNow() }
  const offline = roster.members.filter(
    (member) => member.lifecycle === 'active' && member.show === 'OFFLINE' && member.jid,
  )
  const at = isoNow()
  if (offline.length === 0) {
    return {
      loopId,
      at,
      healthScore: typeof snapshot.healthScore === 'number' ? snapshot.healthScore : 100,
      findings: [],
      actions: [],
    }
  }
  return {
    loopId,
    at,
    healthScore: Math.max(0, 100 - offline.length * 25),
    findings: offline.map((member) => {
      const finding: HealPlan['findings'][number] = {
        code: 'member.offline',
        detail: `Member ${member.jid ?? '?'} is offline`,
        severity: 'warn',
      }
      if (member.jid !== undefined) finding.jid = member.jid
      return finding
    }),
    actions: [
      ...offline.map((member) => ({
        type: 'nudge_rejoin' as const,
        jid: member.jid!,
      })),
      {
        type: 'escalate_admin' as const,
        message: 'Collab healer: review offline members and reassign orphaned goals if needed',
      },
    ],
  }
}

/** Deterministic task plan: three sequential subtasks from a hint. */
export function heuristicTaskPlan(
  loopId: string,
  hint: string,
  _vision?: CollabVision,
): TaskPlan {
  const rootGoal = hint.trim()
  return {
    loopId,
    rootGoal,
    subtasks: [
      { id: 'sub-1', title: `Research: ${rootGoal}` },
      { id: 'sub-2', title: `Implement: ${rootGoal}`, dependsOn: ['sub-1'] },
      { id: 'sub-3', title: `Verify: ${rootGoal}`, dependsOn: ['sub-2'] },
    ],
  }
}

async function streamLlmJson(
  ctx: Context,
  system: string,
  user: string,
  plugin: string,
): Promise<Record<string, unknown> | null> {
  const services = hostServicesFromContext(ctx)
  if (!services) return null
  try {
    const selection = services.agentDefaultModel?.currentSelection()
    if (!selection?.provider || !selection?.model) return null
    const messages: Message[] = [createUserMessage({
      content: [{ type: 'text', text: user }],
      source: { kind: 'plugin', plugin },
    })]
    const options: GenerateOptions = {
      provider: selection.provider,
      model: selection.model,
      messages,
      system,
      maxTokens: 1200,
      signal: new AbortController().signal,
    }
    const assembler = new BlockAssembler()
    for await (const chunk of services.llm.stream(options)) {
      assembler.push(chunk)
    }
    const text = assembler.blocks()
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim()
    return extractJsonObject(text)
  } catch {
    return null
  }
}

/** Prefer Host LLM heal evaluation; returns null when LLM unavailable or invalid. */
export async function evaluateHealWithLlm(
  ctx: Context,
  snapshot: CollabNetworkSnapshot,
): Promise<HealPlan | null> {
  const loopId = loopIdFromSnapshot(snapshot)
  const user = [
    'Evaluate collab loop health and propose heal actions.',
    '',
    '## Network snapshot JSON',
    JSON.stringify(snapshot, null, 2),
  ].join('\n')
  const row = await streamLlmJson(ctx, HEAL_SYSTEM, user, 'dsh-plugin-desktop/collab-host')
  if (!row) return null
  try {
    const plan = parseHealPlan({ ...row, loopId: row.loopId ?? loopId, at: row.at ?? isoNow() })
    validateHealPlan(plan)
    return plan
  } catch {
    return null
  }
}

/** Prefer Host LLM task planning; returns null when LLM unavailable or invalid. */
export async function evaluateTaskPlanWithLlm(
  ctx: Context,
  loopId: string,
  hint: string,
  vision?: CollabVision,
): Promise<TaskPlan | null> {
  const user = [
    'Decompose the collab goal into subtasks.',
    `Goal hint: ${hint.trim()}`,
    vision ? ['', '## Vision JSON', JSON.stringify(vision, null, 2)].join('\n') : '',
  ].join('\n')
  const row = await streamLlmJson(ctx, PLAN_SYSTEM, user, 'dsh-plugin-desktop/collab-host')
  if (!row) return null
  try {
    const plan = parseTaskPlan({
      ...row,
      loopId: row.loopId ?? loopId,
      rootGoal: row.rootGoal ?? hint.trim(),
    })
    validateTaskPlan(plan)
    return plan
  } catch {
    return null
  }
}
