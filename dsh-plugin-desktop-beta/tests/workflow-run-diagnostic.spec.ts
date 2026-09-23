import { describe, expect, it } from 'vitest'
import type {
  RunStepView,
  WorkflowRunView,
  WorkflowStepView,
  WorkflowTranscriptEventView,
  WorkflowView,
} from '../src/client/desktop-workflow-api.ts'
import {
  buildAdviceHints,
  buildDiagnosisPrompt,
  buildRunDiagnosticMarkdown,
  interestingSteps,
  truncateText,
  withWorkflowIdentity,
} from '../src/client/workflow-run-diagnostic.ts'
import { zh, type WorkflowLocaleKey } from '../src/client/locales-workflow.ts'

const t = (key: WorkflowLocaleKey): string => zh[key]

/** Run-side step (no `type` — that lives on the workflow definition). */
function step(partial: Partial<RunStepView> & { id: string }): RunStepView {
  return { status: 'completed', ...partial }
}

/** Workflow-definition step (owns `type`). */
function defStep(
  partial: Partial<WorkflowStepView> & { id: string; type: WorkflowStepView['type'] },
): WorkflowStepView {
  return partial as WorkflowStepView
}

function run(partial: Partial<WorkflowRunView> = {}): WorkflowRunView {
  return {
    id: 'run-1',
    workflowName: 'review-flow',
    status: 'failed',
    startedAt: '2026-09-23T01:00:00.000Z',
    completedAt: '2026-09-23T01:00:30.000Z',
    ...partial,
  }
}

const transcript: WorkflowTranscriptEventView[] = [
  { ts: '2026-09-23T01:00:01.000Z', type: 'run.start', data: { runId: 'run-1' } },
  { ts: '2026-09-23T01:00:02.000Z', type: 'dispatch.submit', stepId: 'lint', dispatchId: 'd1' },
  {
    ts: '2026-09-23T01:00:05.000Z',
    type: 'dispatch.settle',
    stepId: 'lint',
    dispatchId: 'd1',
    data: { status: 'failed', error: 'exit 1' },
  },
]

const workflow: WorkflowView = {
  uid: 'uid-123',
  name: 'review-flow',
  title: 'Review flow',
  steps: [
    defStep({ id: 'lint', type: 'script' }),
    defStep({ id: 'review', type: 'llm' }),
    defStep({
      id: 'gate-1',
      type: 'approval',
      question: '继续？',
      options: ['yes', 'no'],
      pass: ['yes'],
    }),
  ],
}

describe('truncateText', () => {
  it('keeps short text intact and marks truncation', () => {
    expect(truncateText('abc', 10)).toBe('abc')
    expect(truncateText('abcdef', 3)).toBe('abc…')
    expect(truncateText('  spaced  ', 10)).toBe('spaced')
    expect(truncateText('abc', 0)).toBe('')
  })
})

describe('interestingSteps', () => {
  it('picks failed, retried, compensated and errored steps', () => {
    const steps: RunStepView[] = [
      step({ id: 'ok' }),
      step({ id: 'failed', status: 'failed' }),
      step({ id: 'retried', attempt: 3 }),
      step({ id: 'comp', dispatches: [{ id: 'd9', status: 'completed', phase: 'compensate' }] }),
      step({ id: 'errored', error: 'boom' }),
    ]
    expect(interestingSteps(steps).map((s) => s.id)).toEqual(['failed', 'retried', 'comp', 'errored'])
  })
})

describe('buildAdviceHints', () => {
  it('reports a clean run when nothing is off', () => {
    expect(buildAdviceHints([step({ id: 'ok' })], t)).toEqual([zh.diagHintClean])
  })

  it('surfaces first failure, retries, compensation and timeouts', () => {
    const hints = buildAdviceHints(
      [
        step({ id: 'alpha', status: 'failed', error: 'ETIMEDOUT: timed out' }),
        step({ id: 'bravo', attempt: 2 }),
        step({ id: 'charlie', dispatches: [{ id: 'd', status: 'completed', phase: 'compensate' }] }),
        step({ id: 'delta', status: 'pending' }),
      ],
      t,
    )
    const joined = hints.join('\n')
    expect(joined).toContain('alpha')
    expect(joined).toContain('bravo')
    expect(joined).toContain('charlie')
    expect(joined).toContain('delta')
    expect(hints).toHaveLength(5)
  })
})

describe('buildRunDiagnosticMarkdown', () => {
  const steps: RunStepView[] = [
    step({ id: 'lint', status: 'completed', attempt: 1, durationMs: 1200, output: 'ok' }),
    step({
      id: 'review',
      status: 'failed',
      attempt: 2,
      durationMs: 4300,
      error: 'model refused',
      output: 'partial output',
      dispatches: [
        { id: 'd1', status: 'failed', attempt: 1, phase: 'execute', error: 'timeout' },
        { id: 'd2', status: 'failed', attempt: 2, phase: 'execute', error: 'model refused' },
        { id: 'd3', status: 'completed', phase: 'compensate' },
      ],
    }),
  ]

  const md = buildRunDiagnosticMarkdown({
    run: run({ steps, gates: [{ runId: 'run-1', stepId: 'gate-1', question: '继续？', options: ['yes', 'no'], pass: ['yes'], token: 'tok' }] }),
    transcript,
    workflow,
    t,
    options: { generatedAt: '2026-09-23T02:00:00.000Z' },
  })

  it('emits every top-level section', () => {
    for (const heading of [
      zh.diagSectionOverview,
      zh.diagSectionSteps,
      zh.diagSectionFailures,
      zh.diagSectionTimeline,
      zh.diagSectionGates,
      zh.diagSectionAdvice,
    ]) {
      expect(md).toContain(`## ${heading}`)
    }
    expect(md.startsWith('# ')).toBe(true)
  })

  it('summarises run metadata and progress', () => {
    expect(md).toContain('| workflow | review-flow |')
    expect(md).toContain('| status | 失败 |')
    expect(md).toContain('| progress | 1/2 |')
    expect(md).toContain('Generated at: 2026-09-23T02:00:00.000Z'.replace('Generated at', zh.diagGeneratedAt))
  })

  it('lists per-step rows including dispatch counts', () => {
    expect(md).toContain('| review | llm | 失败 | 2 | 4.3s | 3 | model refused |')
  })

  it('expands failures with errors, outputs and the dispatch table', () => {
    expect(md).toContain('### `review`')
    expect(md).toContain('model refused')
    expect(md).toContain('partial output')
    expect(md).toContain('| d1 | 1 | execute |')
    expect(md).toContain('compensate')
  })

  it('renders the narrative timeline and gate section', () => {
    expect(md).toContain('## ' + zh.diagSectionTimeline)
    expect(md).toContain('`2026-09-23T01:00:02.000Z`')
    expect(md).toContain('## ' + zh.diagSectionGates)
    expect(md).toContain('gate-1')
    expect(md).toContain(zh.diagGatePending)
  })

  it('truncates long outputs unless full output is requested', () => {
    const long = 'x'.repeat(5000)
    const truncated = buildRunDiagnosticMarkdown({
      run: run({ steps: [step({ id: 's', status: 'failed', error: long })] }),
      transcript: [],
      t,
      options: { generatedAt: 't', maxOutputCharsPerStep: 100 },
    })
    expect(truncated).toContain('x'.repeat(100) + '…')
    expect(truncated).not.toContain(long)

    const full = buildRunDiagnosticMarkdown({
      run: run({ steps: [step({ id: 's', status: 'failed', error: long })] }),
      transcript: [],
      t,
      options: { generatedAt: 't', includeFullOutputs: true },
    })
    expect(full).toContain(long)
  })

  it('marks an empty run as having no events', () => {
    const empty = buildRunDiagnosticMarkdown({
      run: run({ steps: [] }),
      transcript: [],
      t,
      options: { generatedAt: 't' },
    })
    expect(empty).toContain(zh.diagTimelineEmpty)
    expect(empty).toContain(zh.diagNone)
    expect(empty).toContain(zh.diagHintClean)
  })
})

describe('buildDiagnosisPrompt', () => {
  it('leads with the instruction and appends the markdown context', () => {
    const prompt = buildDiagnosisPrompt({
      markdown: '# report',
      workflowName: 'review-flow',
      runId: 'run-1',
      t,
    })
    expect(prompt).toContain('review-flow')
    expect(prompt).toContain('run-1')
    expect(prompt).toContain('# report')
    expect(prompt).not.toContain('{workflow}')
  })
})

describe('withWorkflowIdentity', () => {
  const generated = [
    'apiVersion: workflow-wise/v1',
    'kind: Workflow',
    'metadata:',
    '  name: wrong-name',
    '  title: T',
    'steps: []',
  ].join('\n')

  it('replaces name and inserts uid on generated YAML', () => {
    const out = withWorkflowIdentity(generated, { uid: 'uid-123', name: 'review-flow' })
    expect(out).toContain('  uid: uid-123')
    expect(out).toContain('  name: review-flow')
    expect(out).not.toContain('wrong-name')
    expect(out).toContain('  title: T')
  })

  it('drops a stale uid and rewrites it', () => {
    const withUid = generated.replace('  name:', '  uid: stale\n  name:')
    const out = withWorkflowIdentity(withUid, { uid: 'uid-123', name: 'review-flow' })
    expect(out).not.toContain('stale')
    expect(out.match(/uid: /g)).toHaveLength(1)
    expect(out).toContain('uid: uid-123')
  })

  it('omits uid when the workflow has none', () => {
    const out = withWorkflowIdentity(generated, { name: 'review-flow' })
    expect(out).not.toContain('uid:')
    expect(out).toContain('  name: review-flow')
  })

  it('prepends a metadata block when the model output lost it', () => {
    const out = withWorkflowIdentity('steps: []', { uid: 'uid-1', name: 'n' })
    expect(out.startsWith('metadata:')).toBe(true)
    expect(out).toContain('  uid: uid-1')
    expect(out).toContain('  name: n')
  })
})
