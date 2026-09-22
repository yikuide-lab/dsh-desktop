/**
 * Per-workflow usage aggregates derived from retained run history.
 */

import { WorkflowStatus, type Run, type Workflow } from './models.js'

export interface WorkflowStatsSummary {
  readonly workflowName: string
  readonly title?: string
  readonly totalRuns: number
  readonly completed: number
  readonly failed: number
  readonly aborted: number
  readonly running: number
  /** completed / (completed + failed + aborted); 0 when no terminal runs. */
  readonly successRate: number
  readonly avgDurationMs: number | null
  readonly lastRunAt: string | null
  readonly lastStatus: string | null
}

export interface WorkflowStatsDayBucket {
  readonly date: string
  readonly total: number
  readonly completed: number
  readonly failed: number
  readonly avgDurationMs: number | null
}

export interface WorkflowStatsRecentRun {
  readonly id: string
  readonly status: string
  readonly startedAt: string
  readonly completedAt?: string
  readonly durationMs?: number
  readonly error?: string
}

export interface WorkflowStatsDetail extends WorkflowStatsSummary {
  readonly byDay: readonly WorkflowStatsDayBucket[]
  readonly recentRuns: readonly WorkflowStatsRecentRun[]
}

const TERMINAL = new Set<string>([
  WorkflowStatus.Completed,
  WorkflowStatus.Failed,
  WorkflowStatus.Aborted,
  WorkflowStatus.Rejected,
])

/** Top-level runs only (exclude nested sub_workflow children). */
export function isTopLevelRun(run: Run): boolean {
  return !run.parentRunId
}

function durationMs(run: Run): number | null {
  if (!run.completedAt) return null
  const start = Date.parse(run.startedAt)
  const end = Date.parse(run.completedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return end - start
}

function dayKey(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return 'unknown'
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

/** Aggregate retained top-level runs for one workflow. */
export function summarizeWorkflowRuns(
  workflowName: string,
  runs: readonly Run[],
  title?: string,
): WorkflowStatsSummary {
  const top = runs.filter((run) => run.workflowName === workflowName && isTopLevelRun(run))
  let completed = 0
  let failed = 0
  let aborted = 0
  let running = 0
  const durations: number[] = []
  let last: Run | null = null

  for (const run of top) {
    if (!last || String(run.startedAt).localeCompare(String(last.startedAt)) > 0) {
      last = run
    }
    if (run.status === WorkflowStatus.Completed) completed += 1
    else if (run.status === WorkflowStatus.Failed) failed += 1
    else if (run.status === WorkflowStatus.Aborted || run.status === WorkflowStatus.Rejected) aborted += 1
    else running += 1
    const dur = durationMs(run)
    if (dur !== null && TERMINAL.has(run.status)) durations.push(dur)
  }

  const terminal = completed + failed + aborted
  return {
    workflowName,
    ...(title ? { title } : {}),
    totalRuns: top.length,
    completed,
    failed,
    aborted,
    running,
    successRate: terminal === 0 ? 0 : completed / terminal,
    avgDurationMs: average(durations),
    lastRunAt: last?.startedAt ?? null,
    lastStatus: last?.status ?? null,
  }
}

export function buildDayBuckets(
  runs: readonly Run[],
  sinceMs: number,
): WorkflowStatsDayBucket[] {
  const buckets = new Map<string, {
    total: number
    completed: number
    failed: number
    durations: number[]
  }>()

  for (const run of runs) {
    if (!isTopLevelRun(run)) continue
    const started = Date.parse(run.startedAt)
    if (!Number.isFinite(started) || started < sinceMs) continue
    const key = dayKey(run.startedAt)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { total: 0, completed: 0, failed: 0, durations: [] }
      buckets.set(key, bucket)
    }
    bucket.total += 1
    if (run.status === WorkflowStatus.Completed) bucket.completed += 1
    if (run.status === WorkflowStatus.Failed) bucket.failed += 1
    const dur = durationMs(run)
    if (dur !== null && TERMINAL.has(run.status)) bucket.durations.push(dur)
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, bucket]) => ({
      date,
      total: bucket.total,
      completed: bucket.completed,
      failed: bucket.failed,
      avgDurationMs: average(bucket.durations),
    }))
}

export function buildRecentRuns(
  runs: readonly Run[],
  limit: number,
): WorkflowStatsRecentRun[] {
  return runs
    .filter(isTopLevelRun)
    .slice()
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    .slice(0, Math.max(0, limit))
    .map((run) => {
      const dur = durationMs(run)
      return {
        id: run.id,
        status: run.status,
        startedAt: run.startedAt,
        ...(run.completedAt ? { completedAt: run.completedAt } : {}),
        ...(dur !== null ? { durationMs: dur } : {}),
        ...(run.error ? { error: run.error } : {}),
      }
    })
}

export function buildWorkflowStatsSummaries(
  workflows: readonly Workflow[],
  allRuns: readonly Run[],
): WorkflowStatsSummary[] {
  const byName = new Map(workflows.map((workflow) => [workflow.metadata.name, workflow] as const))
  const names = new Set<string>([...byName.keys()])
  for (const run of allRuns) {
    if (isTopLevelRun(run)) names.add(run.workflowName)
  }

  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const title = byName.get(name)?.metadata.title
      return summarizeWorkflowRuns(name, allRuns, title)
    })
}

export function buildWorkflowStatsDetail(
  workflowName: string,
  workflows: readonly Workflow[],
  allRuns: readonly Run[],
  options?: { since?: string; recentLimit?: number },
): WorkflowStatsDetail {
  const workflow = workflows.find((entry) => entry.metadata.name === workflowName)
  const scoped = allRuns.filter((run) => run.workflowName === workflowName)
  const summary = summarizeWorkflowRuns(workflowName, scoped, workflow?.metadata.title)
  const sinceMs = options?.since
    ? Date.parse(options.since)
    : Date.now() - 30 * 24 * 60 * 60 * 1000
  const since = Number.isFinite(sinceMs) ? sinceMs : Date.now() - 30 * 24 * 60 * 60 * 1000
  const recentLimit = options?.recentLimit ?? 20

  return {
    ...summary,
    byDay: buildDayBuckets(scoped, since),
    recentRuns: buildRecentRuns(scoped, recentLimit),
  }
}
