import { describe, expect, it } from 'vitest'
import type {
  WorkflowRunView,
  WorkflowTranscriptEventView,
} from '../src/client/desktop-workflow-api.ts'
import type { PendingGateView } from '../src/client/workflow-store.ts'
import {
  buildGateAdvicePrompt,
  parseGateAdvice,
  recommendedOption,
} from '../src/client/workflow-gate-advice.ts'
import { zh, type WorkflowLocaleKey } from '../src/client/locales-workflow.ts'

const t = (key: WorkflowLocaleKey): string => zh[key]

const run: WorkflowRunView = {
  id: 'run-1',
  workflowName: 'review-flow',
  status: 'running',
  startedAt: '2026-09-24T01:00:00.000Z',
  steps: [
    { id: 'lint', status: 'completed', attempt: 1 },
    { id: 'gate-1', status: 'pending' },
  ],
}

const transcript: WorkflowTranscriptEventView[] = [
  { ts: '2026-09-24T01:00:01.000Z', type: 'run.start', data: { runId: 'run-1' } },
]

const gate: PendingGateView = {
  runId: 'run-1',
  stepId: 'gate-1',
  question: '是否进入生产？',
  options: ['yes', 'no'],
  pass: ['yes'],
  token: 'tok',
}

describe('buildGateAdvicePrompt', () => {
  const prompt = buildGateAdvicePrompt({ run, transcript, gate, t })

  it('states that the human holds the final decision', () => {
    expect(prompt).toContain('human holds the final decision')
  })

  it('carries the gate and the run evidence', () => {
    expect(prompt).toContain('gate-1')
    expect(prompt).toContain('是否进入生产？')
    expect(prompt).toContain('review-flow')
    expect(prompt).toContain(zh.diagSectionSteps)
  })

  it('constrains the reply to one YAML block with two fields', () => {
    expect(prompt).toContain('```yaml')
    expect(prompt).toContain('recommendation: approve | reject | uncertain')
    expect(prompt).toContain('reason:')
  })
})

describe('parseGateAdvice', () => {
  it('reads a fenced reply', () => {
    expect(parseGateAdvice('```yaml\nrecommendation: approve\nreason: 前置步骤全部通过\n```'))
      .toEqual({ recommendation: 'approve', reason: '前置步骤全部通过' })
  })

  it('reads an unfenced reply and strips quotes', () => {
    expect(parseGateAdvice('recommendation: "reject"\nreason: \'lint 失败未补偿\''))
      .toEqual({ recommendation: 'reject', reason: 'lint 失败未补偿' })
  })

  it('maps insufficient evidence to uncertain', () => {
    expect(parseGateAdvice('recommendation: uncertain\nreason: 缺少输出')?.recommendation).toBe('uncertain')
  })

  it('rejects a reply that is not the expected shape', () => {
    expect(parseGateAdvice('recommendation: maybe\nreason: x')).toBeNull()
    expect(parseGateAdvice('reason: 只有理由')).toBeNull()
    expect(parseGateAdvice('')).toBeNull()
  })
})

describe('recommendedOption', () => {
  it('maps approve to a pass option and reject to a failing one', () => {
    const g = { options: ['no', 'yes'], pass: ['yes'] }
    expect(recommendedOption(g, { recommendation: 'approve', reason: '' })).toBe('yes')
    expect(recommendedOption(g, { recommendation: 'reject', reason: '' })).toBe('no')
  })

  it('highlights nothing when the evidence is insufficient', () => {
    expect(recommendedOption({ options: ['yes', 'no'] }, { recommendation: 'uncertain', reason: '' }))
      .toBeNull()
  })
})
