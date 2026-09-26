/**
 * Collab healer/planner heuristic helpers (no Host LLM).
 */

import { describe, expect, it } from 'vitest'
import {
  heuristicHealEvaluate,
  heuristicTaskPlan,
} from '../src/collab-host/llm.ts'
import type { LoopRoster } from 'dsh-plugin-workflow/collab'

describe('collab host llm heuristics', () => {
  it('heuristic heal nudges offline members and escalates', () => {
    const roster: LoopRoster = {
      loopId: 'loop-heal',
      updatedAt: new Date(0).toISOString(),
      members: [
        {
          jid: 'session@desktop.local/ses-1',
          kind: 'session',
          slot: 'slot-a',
          lifecycle: 'active',
          show: 'OFFLINE',
          epoch: 1,
        },
      ],
    }
    const plan = heuristicHealEvaluate({ loop: { loopId: 'loop-heal' }, roster })
    expect(plan.findings).toHaveLength(1)
    expect(plan.actions.some((action) => action.type === 'nudge_rejoin')).toBe(true)
    expect(plan.actions.some((action) => action.type === 'escalate_admin')).toBe(true)
  })

  it('heuristic plan builds three sequential subtasks from hint', () => {
    const plan = heuristicTaskPlan('loop-plan', 'Ship collab MVP')
    expect(plan.rootGoal).toBe('Ship collab MVP')
    expect(plan.subtasks).toHaveLength(3)
    expect(plan.subtasks[1]?.dependsOn).toEqual(['sub-1'])
    expect(plan.subtasks[2]?.dependsOn).toEqual(['sub-2'])
  })
})
