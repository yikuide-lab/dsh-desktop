/** AI-assisted project task planning. */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { hostServicesFromContext } from '../desktop-workflow-executor.ts'
import { addDays, localDateString } from './dates.js'
import {
  isProjectTaskStatus,
  type ProjectPlanDraft,
  type ProjectTaskDraft,
  type TimeMasterContextSnapshot,
} from './types.js'

const SYSTEM = `You plan a software project for DSH Desktop Time Master.
Return ONLY a single JSON object with keys:
title, goal, status (active|paused|done), tasks (array of { title, status (todo|doing|blocked|done), dueAt (YYYY-MM-DD), estimateHours?, notes?, workflowName?, sessionId? }).
Provide 3–6 actionable tasks with realistic due dates anchored to today.
No markdown fences.`

function parseProjectJson(raw: string, today: string): ProjectPlanDraft | null {
  const trimmed = raw.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const row = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>
    const title = typeof row.title === 'string' ? row.title.trim() : ''
    const goal = typeof row.goal === 'string' ? row.goal.trim() : ''
    if (!title || !goal) return null
    const tasks: ProjectTaskDraft[] = []
    if (Array.isArray(row.tasks)) {
      for (const entry of row.tasks) {
        if (!entry || typeof entry !== 'object') continue
        const task = entry as Record<string, unknown>
        const taskTitle = typeof task.title === 'string' ? task.title.trim() : ''
        if (!taskTitle) continue
        tasks.push({
          title: taskTitle,
          status: isProjectTaskStatus(task.status) ? task.status : 'todo',
          dueAt: typeof task.dueAt === 'string' ? task.dueAt : undefined,
          ...(typeof task.estimateHours === 'number' ? { estimateHours: task.estimateHours } : {}),
          ...(typeof task.notes === 'string' ? { notes: task.notes } : {}),
          ...(typeof task.workflowName === 'string' ? { workflowName: task.workflowName } : {}),
          ...(typeof task.sessionId === 'string' ? { sessionId: task.sessionId } : {}),
        })
      }
    }
    if (tasks.length === 0) return null
    return { title, goal, status: 'active', tasks }
  } catch {
    return null
  }
}

/** Heuristic 3-task project plan. */
export function heuristicPlanProject(input: {
  context: TimeMasterContextSnapshot
  hint?: string
}): ProjectPlanDraft {
  const today = input.context.today || localDateString()
  const hint = input.hint?.trim() || 'New project'
  const workflow = input.context.workflowNames[0]

  return {
    title: hint.length > 48 ? `${hint.slice(0, 45)}…` : hint,
    goal: hint,
    status: 'active',
    tasks: [
      {
        title: 'Define scope and acceptance criteria',
        status: 'todo',
        dueAt: addDays(today, 3) ?? today,
        estimateHours: 2,
        ...(workflow ? { workflowName: workflow } : {}),
      },
      {
        title: 'Implement core changes',
        status: 'todo',
        dueAt: addDays(today, 10) ?? today,
        estimateHours: 8,
        ...(workflow ? { workflowName: workflow } : {}),
      },
      {
        title: 'Verify and document',
        status: 'todo',
        dueAt: addDays(today, 14) ?? today,
        estimateHours: 3,
      },
    ],
  }
}

async function llmPlan(
  ctx: Context,
  context: TimeMasterContextSnapshot,
  hint: string,
): Promise<ProjectPlanDraft | null> {
  const services = hostServicesFromContext(ctx)
  if (!services) return null

  const user = [
    'Draft a project plan with tasks.',
    hint ? `Goal: ${hint}` : 'No goal hint; infer from context.',
    '',
    '## Context',
    JSON.stringify(context, null, 2),
  ].join('\n')

  try {
    const selection = services.agentDefaultModel?.currentSelection()
    if (!selection?.provider || !selection?.model) return null
    const messages: Message[] = [createUserMessage({
      content: [{ type: 'text', text: user }],
      source: { kind: 'plugin', plugin: 'dsh-plugin-desktop/time-master' },
    })]
    const options: GenerateOptions = {
      provider: selection.provider,
      model: selection.model,
      messages,
      system: SYSTEM,
      maxTokens: 1200,
      signal: new AbortController().signal,
    }
    const assembler = new BlockAssembler()
    for await (const chunk of services.llm.stream(options)) {
      assembler.push(chunk)
    }
    const text = assembler.blocks()
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim()
    return parseProjectJson(text, context.today)
  } catch {
    return null
  }
}

export async function planProject(input: {
  ctx: Context
  context: TimeMasterContextSnapshot
  hint?: string
}): Promise<{ draft: ProjectPlanDraft; source: 'ai' | 'heuristic' }> {
  const hint = input.hint?.trim() ?? ''
  const ai = await llmPlan(input.ctx, input.context, hint)
  if (ai?.title && ai.goal && ai.tasks && ai.tasks.length > 0) {
    return { draft: ai, source: 'ai' }
  }
  return {
    draft: heuristicPlanProject({ context: input.context, hint }),
    source: 'heuristic',
  }
}
