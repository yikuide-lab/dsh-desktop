import { describe, expect, it } from 'vitest'
import { WorkflowStatus, type Run, type Workflow } from '../src/engine/models.ts'
import {
  buildDayBuckets,
  buildRecentRuns,
  buildWorkflowStatsDetail,
  buildWorkflowStatsSummaries,
  isTopLevelRun,
  summarizeWorkflowRuns,
} from '../src/engine/workflow-stats.ts'

function run(partial: Partial<Run> & Pick<Run, 'id' | 'workflowName' | 'status' | 'startedAt'>): Run {
  return {
    tasks: {},
    gates: {},
    ...partial,
  }
}

const workflows: Workflow[] = [
  {
    apiVersion: 'workflow-wise/v1',
    kind: 'Workflow',
    metadata: { name: 'alpha', title: 'Alpha Flow' },
    spec: { steps: [] },
  },
  {
    apiVersion: 'workflow-wise/v1',
    kind: 'Workflow',
    metadata: { name: 'beta' },
    spec: { steps: [] },
  },
]

describe('workflow-stats aggregation', () => {
  it('treats only top-level runs as countable', () => {
    expect(isTopLevelRun(run({
      id: 'r1',
      workflowName: 'alpha',
      status: WorkflowStatus.Completed,
      startedAt: '2026-01-01T00:00:00.000Z',
    }))).toBe(true)
    expect(isTopLevelRun(run({
      id: 'r2',
      workflowName: 'alpha',
      status: WorkflowStatus.Completed,
      startedAt: '2026-01-01T00:00:00.000Z',
      parentRunId: 'r1',
    }))).toBe(false)
  })

  it('summarizes counts, success rate, duration, and last run', () => {
    const runs = [
      run({
        id: 'c1',
        workflowName: 'alpha',
        status: WorkflowStatus.Completed,
        startedAt: '2026-03-01T10:00:00.000Z',
        completedAt: '2026-03-01T10:00:30.000Z',
      }),
      run({
        id: 'f1',
        workflowName: 'alpha',
        status: WorkflowStatus.Failed,
        startedAt: '2026-03-02T10:00:00.000Z',
        completedAt: '2026-03-02T10:01:00.000Z',
        error: 'boom',
      }),
      run({
        id: 'a1',
        workflowName: 'alpha',
        status: WorkflowStatus.Aborted,
        startedAt: '2026-03-03T10:00:00.000Z',
        completedAt: '2026-03-03T10:00:10.000Z',
      }),
      run({
        id: 'child',
        workflowName: 'alpha',
        status: WorkflowStatus.Completed,
        startedAt: '2026-03-04T10:00:00.000Z',
        completedAt: '2026-03-04T10:00:05.000Z',
        parentRunId: 'c1',
      }),
      run({
        id: 'live',
        workflowName: 'alpha',
        status: WorkflowStatus.Running,
        startedAt: '2026-03-05T10:00:00.000Z',
      }),
    ]

    const summary = summarizeWorkflowRuns('alpha', runs, 'Alpha Flow')
    expect(summary).toMatchObject({
      workflowName: 'alpha',
      title: 'Alpha Flow',
      totalRuns: 4,
      completed: 1,
      failed: 1,
      aborted: 1,
      running: 1,
      lastRunAt: '2026-03-05T10:00:00.000Z',
      lastStatus: WorkflowStatus.Running,
    })
    expect(summary.successRate).toBeCloseTo(1 / 3)
    expect(summary.avgDurationMs).toBe(Math.round((30_000 + 60_000 + 10_000) / 3))
  })

  it('returns zero summaries for workflows without runs', () => {
    const summaries = buildWorkflowStatsSummaries(workflows, [])
    expect(summaries).toHaveLength(2)
    expect(summaries.find((entry) => entry.workflowName === 'alpha')).toMatchObject({
      totalRuns: 0,
      completed: 0,
      successRate: 0,
      avgDurationMs: null,
      lastRunAt: null,
    })
  })

  it('builds day buckets and recent runs for detail', () => {
    // Midday local instants avoid UTC/local date-boundary flakiness.
    const dayAMorning = new Date(2026, 8, 1, 10, 0, 0).toISOString()
    const dayAAfternoon = new Date(2026, 8, 1, 15, 0, 0).toISOString()
    const dayB = new Date(2026, 8, 2, 11, 0, 0).toISOString()
    const dayAKey = '2026-09-01'

    const runs = [
      run({
        id: 'old',
        workflowName: 'alpha',
        status: WorkflowStatus.Completed,
        startedAt: '2020-01-01T12:00:00.000Z',
        completedAt: '2020-01-01T12:00:10.000Z',
      }),
      run({
        id: 'd1',
        workflowName: 'alpha',
        status: WorkflowStatus.Completed,
        startedAt: dayAMorning,
        completedAt: new Date(Date.parse(dayAMorning) + 20_000).toISOString(),
      }),
      run({
        id: 'd2',
        workflowName: 'alpha',
        status: WorkflowStatus.Failed,
        startedAt: dayAAfternoon,
        completedAt: new Date(Date.parse(dayAAfternoon) + 40_000).toISOString(),
        error: 'x',
      }),
      run({
        id: 'd3',
        workflowName: 'alpha',
        status: WorkflowStatus.Completed,
        startedAt: dayB,
        completedAt: new Date(Date.parse(dayB) + 5_000).toISOString(),
      }),
    ]

    const buckets = buildDayBuckets(runs, Date.parse('2026-08-01T00:00:00.000Z'))
    const day1 = buckets.find((bucket) => bucket.date === dayAKey)
    expect(day1).toMatchObject({ total: 2, completed: 1, failed: 1 })
    expect(day1?.avgDurationMs).toBe(30_000)

    const recent = buildRecentRuns(runs, 2)
    expect(recent.map((entry) => entry.id)).toEqual(['d3', 'd2'])
    expect(recent[1]?.error).toBe('x')

    const detail = buildWorkflowStatsDetail('alpha', workflows, runs, {
      since: '2026-08-01T00:00:00.000Z',
      recentLimit: 2,
    })
    expect(detail.title).toBe('Alpha Flow')
    expect(detail.recentRuns).toHaveLength(2)
    expect(detail.byDay.length).toBeGreaterThanOrEqual(1)
  })
})
