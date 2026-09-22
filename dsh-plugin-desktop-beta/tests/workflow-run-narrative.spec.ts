import { describe, expect, it } from 'vitest'
import {
  buildNarrative,
  entryDetailRaw,
  fill,
  formatNarrativeTitle,
  lastEntryIndexForStep,
  narrativeKind,
  narrativeTone,
  STEP_TYPE_COLORS,
} from '../src/client/workflow-run-narrative.ts'
import type {
  RunStepView,
  WorkflowTranscriptEventView,
} from '../src/client/desktop-workflow-api.ts'
import { zh } from '../src/client/locales-workflow.ts'

const t = (key: string): string => (zh as Record<string, string>)[key] ?? key

function ev(partial: Partial<WorkflowTranscriptEventView> & { type: string }): WorkflowTranscriptEventView {
  return { ts: '2026-01-01T00:00:00.000Z', ...partial }
}

describe('narrativeKind', () => {
  it('maps all transcript event types', () => {
    expect(narrativeKind('run.start')).toBe('run-start')
    expect(narrativeKind('run.complete')).toBe('run-done')
    expect(narrativeKind('run.fail')).toBe('run-fail')
    expect(narrativeKind('run.abort')).toBe('run-abort')
    expect(narrativeKind('run.orphan')).toBe('run-orphan')
    expect(narrativeKind('dispatch.submit')).toBe('step-start')
    expect(narrativeKind('dispatch.settle')).toBe('step-done')
    expect(narrativeKind('gate.resolve')).toBe('gate')
    expect(narrativeKind('llm.request')).toBe('llm')
    expect(narrativeKind('llm.response')).toBe('llm')
    expect(narrativeKind('task.request')).toBe('task')
    expect(narrativeKind('task.response')).toBe('task')
    expect(narrativeKind('script.result')).toBe('script')
    expect(narrativeKind('error')).toBe('error')
    expect(narrativeKind('something-new')).toBe('muted')
  })
})

describe('narrativeTone', () => {
  it('tones terminal failures as error and successes as success', () => {
    expect(narrativeTone('step-done')).toBe('success')
    expect(narrativeTone('step-fail')).toBe('error')
    expect(narrativeTone('run-fail')).toBe('error')
    expect(narrativeTone('run-abort')).toBe('warn')
    expect(narrativeTone('gate')).toBe('warn')
    expect(narrativeTone('muted')).toBe('muted')
  })
})

describe('fill', () => {
  it('substitutes placeholders', () => {
    expect(fill('step {step} in {dur}', { step: 'a', dur: '2.0s' })).toBe('step a in 2.0s')
    expect(fill('no slots', { x: 1 })).toBe('no slots')
  })
})

describe('entryDetailRaw', () => {
  it('skips noisy keys and formats the rest', () => {
    const raw = entryDetailRaw({
      success: true,
      error: 'boom',
      params: { a: 1 },
      cwd: '/tmp',
      live: true,
    })
    expect(raw).toContain('success: true')
    expect(raw).toContain('error: boom')
    expect(raw).not.toContain('params')
    expect(raw).not.toContain('cwd')
    expect(raw).not.toContain('live')
  })

  it('returns undefined when nothing is left', () => {
    expect(entryDetailRaw(undefined)).toBeUndefined()
    expect(entryDetailRaw({ params: {} })).toBeUndefined()
  })

  it('truncates long payloads', () => {
    const raw = entryDetailRaw({ output: 'x'.repeat(2000) })
    expect(raw!.length).toBeLessThan(800)
    expect(raw).toContain('…')
  })
})

describe('formatNarrativeTitle', () => {
  it('wordstep start / retry', () => {
    const start = formatNarrativeTitle(ev({ type: 'dispatch.submit', stepId: 'a' }), t, { attempt: 1 })
    expect(start.title).toContain('a')
    expect(start.kind).toBe('step-start')

    const retry = formatNarrativeTitle(ev({ type: 'dispatch.submit', stepId: 'a' }), t, { attempt: 2 })
    expect(retry.title).toContain('2')
  })

  it('words settle success with duration', () => {
    const done = formatNarrativeTitle(
      ev({ type: 'dispatch.settle', stepId: 'a', data: { success: true } }),
      t,
      { attempt: 1, durationMs: 2300 },
    )
    expect(done.kind).toBe('step-done')
    expect(done.tone).toBe('success')
    expect(done.title).toContain('2.3s')
  })

  it('words settle failure with retry hint', () => {
    const failRetry = formatNarrativeTitle(
      ev({ type: 'dispatch.settle', stepId: 'a', data: { success: false, error: 'boom' } }),
      t,
      { attempt: 2 },
    )
    expect(failRetry.kind).toBe('step-fail')
    expect(failRetry.tone).toBe('error')
    expect(failRetry.title).toContain('boom')

    const failFinal = formatNarrativeTitle(
      ev({ type: 'dispatch.settle', stepId: 'a', data: { success: false, error: 'boom' } }),
      t,
      { attempt: 1 },
    )
    expect(failFinal.kind).toBe('step-fail')
  })

  it('words gate resolution', () => {
    const gate = formatNarrativeTitle(
      ev({
        type: 'gate.resolve',
        stepId: 'approve',
        data: { decision: 'approved', resolvedBy: 'alice', live: true },
      }),
      t,
    )
    expect(gate.kind).toBe('gate')
    expect(gate.title).toContain('alice')
    expect(gate.title).toContain('approved')
  })

  it('words llm request/response/failure', () => {
    const req = formatNarrativeTitle(
      ev({ type: 'llm.request', stepId: 'l', data: { model: 'm1', prompt: 'hi' } }),
      t,
    )
    expect(req.title).toContain('m1')

    const resp = formatNarrativeTitle(
      ev({ type: 'llm.response', stepId: 'l', data: { ok: true, output: 'abc' } }),
      t,
    )
    expect(resp.kind).toBe('llm')
    expect(resp.title).toContain('3')

    const fail = formatNarrativeTitle(
      ev({ type: 'llm.response', stepId: 'l', data: { ok: false, error: 'nope' } }),
      t,
    )
    expect(fail.kind).toBe('step-fail')
  })

  it('words run lifecycle events', () => {
    expect(formatNarrativeTitle(ev({ type: 'run.start', data: { workflowName: 'demo' } }), t).title)
      .toContain('demo')
    expect(formatNarrativeTitle(ev({ type: 'run.complete' }), t).tone).toBe('success')
    expect(formatNarrativeTitle(ev({ type: 'run.fail', data: { error: 'x' } }), t).tone).toBe('error')
    expect(formatNarrativeTitle(ev({ type: 'run.abort', data: { reason: 'stop' } }), t).tone).toBe('warn')
    expect(formatNarrativeTitle(ev({ type: 'run.orphan' }), t).tone).toBe('warn')
    expect(formatNarrativeTitle(ev({ type: 'error', data: { error: 'bad' } }), t).tone).toBe('error')
  })

  it('falls back to the raw type for unknown events', () => {
    const unknown = formatNarrativeTitle(ev({ type: 'brand.new' }), t)
    expect(unknown.kind).toBe('muted')
    expect(unknown.title).toContain('brand.new')
  })
})

describe('buildNarrative', () => {
  const steps: RunStepView[] = [
    {
      id: 'a',
      status: 'completed',
      attempt: 2,
      durationMs: 2300,
      dispatches: [
        {
          id: 'd-1',
          status: 'failed',
          attempt: 1,
          phase: 'execute',
          startedAt: '2026-01-01T00:00:00.000Z',
          completedAt: '2026-01-01T00:00:00.500Z',
          error: 'boom',
        },
        {
          id: 'd-2',
          status: 'succeeded',
          attempt: 2,
          phase: 'execute',
          startedAt: '2026-01-01T00:00:00.500Z',
          completedAt: '2026-01-01T00:00:02.800Z',
        },
      ],
    },
  ]

  it('enriches dispatch events with attempt and duration', () => {
    const entries = buildNarrative(steps, [
      ev({ type: 'dispatch.submit', stepId: 'a', dispatchId: 'd-1', ts: '2026-01-01T00:00:00.000Z' }),
      ev({
        type: 'dispatch.settle',
        stepId: 'a',
        dispatchId: 'd-1',
        ts: '2026-01-01T00:00:00.500Z',
        data: { success: false, error: 'boom' },
      }),
    ], t)
    expect(entries).toHaveLength(2)
    expect(entries[0]!.attempt).toBe(1)
    expect(entries[1]!.attempt).toBe(1)
    expect(entries[1]!.durationMs).toBe(500)
    expect(entries[1]!.tone).toBe('error')
  })

  it('derives attempt from submit counts when the dispatch is unknown', () => {
    const entries = buildNarrative([], [
      ev({ type: 'dispatch.submit', stepId: 'a', dispatchId: 'x-1', ts: '2026-01-01T00:00:00.000Z' }),
      ev({ type: 'dispatch.submit', stepId: 'a', dispatchId: 'x-2', ts: '2026-01-01T00:00:05.000Z' }),
    ], t)
    expect(entries[0]!.attempt).toBe(1)
    expect(entries[1]!.attempt).toBe(2)
    expect(entries[1]!.title).toContain('2')
  })

  it('sorts entries by timestamp', () => {
    const entries = buildNarrative([], [
      ev({ type: 'run.complete', ts: '2026-01-01T00:00:09.000Z' }),
      ev({ type: 'run.start', ts: '2026-01-01T00:00:01.000Z' }),
      ev({ type: 'dispatch.submit', stepId: 'a', ts: '2026-01-01T00:00:03.000Z' }),
    ], t)
    expect(entries.map((e) => e.kind)).toEqual(['run-start', 'step-start', 'run-done'])
  })

  it('attaches collapsible raw payloads and step ids', () => {
    const entries = buildNarrative([], [
      ev({
        type: 'dispatch.settle',
        stepId: 'a',
        dispatchId: 'd-9',
        ts: '2026-01-01T00:00:01.000Z',
        data: { success: true, output: 'hello' },
      }),
    ], t)
    expect(entries[0]!.stepId).toBe('a')
    expect(entries[0]!.dispatchId).toBe('d-9')
    expect(entries[0]!.raw).toContain('output: hello')
    expect(entries[0]!.id).toContain('dispatch.settle')
  })
})

describe('lastEntryIndexForStep', () => {
  it('finds the latest entry for a step', () => {
    const entries = buildNarrative([], [
      ev({ type: 'dispatch.submit', stepId: 'a', ts: '2026-01-01T00:00:01.000Z' }),
      ev({ type: 'dispatch.submit', stepId: 'b', ts: '2026-01-01T00:00:02.000Z' }),
      ev({ type: 'dispatch.settle', stepId: 'a', data: { success: true }, ts: '2026-01-01T00:00:03.000Z' }),
    ], t)
    expect(lastEntryIndexForStep(entries, 'a')).toBe(2)
    expect(lastEntryIndexForStep(entries, 'b')).toBe(1)
    expect(lastEntryIndexForStep(entries, 'zzz')).toBe(-1)
    expect(lastEntryIndexForStep(entries, null)).toBe(-1)
  })
})

describe('STEP_TYPE_COLORS', () => {
  it('covers every local step type', () => {
    expect(Object.keys(STEP_TYPE_COLORS).sort())
      .toEqual(['approval', 'llm', 'script', 'sub_workflow', 'task'])
  })
})
