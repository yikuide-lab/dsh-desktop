/** Same-origin browser client for Desktop Time Master. */

import type {
  CoordConflict,
  CoordSuggestion,
  ProjectPlan,
  ProjectPlanDraft,
  TokenPlan,
  TokenPlanCycle,
  TokenPlanDraft,
  TimeMasterContextSnapshot,
  UsageSchedule,
  UsageScheduleDraft,
} from '../time-master/types.js'

const TIME_MASTER_PATH = '/api/desktop/time-master'

export type PlanUrgency = 'expired' | 'soon' | 'ok'
export type TaskUrgency = 'expired' | 'soon' | 'ok' | 'none'

export interface TimeMasterPlanView extends TokenPlan {
  readonly urgency: PlanUrgency
}

export interface TimeMasterTaskView {
  readonly id: string
  readonly title: string
  readonly status: 'todo' | 'doing' | 'blocked' | 'done'
  readonly dueAt?: string
  readonly remindDays?: readonly number[]
  readonly estimateHours?: number
  readonly dependsOn?: readonly string[]
  readonly sessionId?: string
  readonly workflowName?: string
  readonly loopId?: string
  readonly planId?: string
  readonly notes?: string
  readonly urgency: TaskUrgency
}

export interface TimeMasterProjectView extends ProjectPlan {
  readonly tasks: TimeMasterTaskView[]
}

export interface CoordSnapshotView {
  readonly today: string
  readonly activeTasks: readonly {
    projectId: string
    projectTitle: string
    task: TimeMasterTaskView
  }[]
  readonly conflicts: readonly CoordConflict[]
}

export interface DesktopTimeMasterApi {
  list(): Promise<{
    today: string
    version: number
    plans: TimeMasterPlanView[]
    schedules: UsageSchedule[]
    projects: TimeMasterProjectView[]
  }>
  upsert(draft: TokenPlanDraft & { id?: string }): Promise<{ plan: TokenPlan; urgency: PlanUrgency }>
  delete(id: string): Promise<void>
  contextSnapshot(): Promise<TimeMasterContextSnapshot>
  aiSuggest(hint?: string): Promise<{ draft: TokenPlanDraft; source: 'ai' | 'heuristic' }>
  scheduleList(): Promise<{ schedules: UsageSchedule[] }>
  scheduleUpsert(draft: UsageScheduleDraft): Promise<{ schedule: UsageSchedule }>
  scheduleDelete(id: string): Promise<void>
  aiOrchestrateUsage(hint?: string): Promise<{ draft: UsageScheduleDraft; source: 'ai' | 'heuristic' }>
  projectList(): Promise<{ projects: TimeMasterProjectView[] }>
  projectUpsert(draft: ProjectPlanDraft): Promise<{ project: ProjectPlan }>
  projectDelete(id: string): Promise<void>
  aiPlanProject(hint?: string): Promise<{ draft: ProjectPlanDraft; source: 'ai' | 'heuristic' }>
  coordSnapshot(): Promise<{ snapshot: CoordSnapshotView }>
  aiCoordinate(options?: { apply?: boolean }): Promise<{
    suggestions: CoordSuggestion[]
    source: 'ai' | 'heuristic'
    snapshot: CoordSnapshotView
    applied: boolean
  }>
}

async function call<T>(
  body: object,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<T> {
  const response = await fetcher(TIME_MASTER_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await response.json() as { ok?: boolean; error?: string } & T
  if (!response.ok || json.ok === false) {
    throw new Error(json.error ?? `time-master failed (${response.status})`)
  }
  return json
}

export function createDesktopTimeMasterApi(
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): DesktopTimeMasterApi {
  return {
    async list() {
      const result = await call<{
        today: string
        version: number
        plans: TimeMasterPlanView[]
        schedules: UsageSchedule[]
        projects: TimeMasterProjectView[]
      }>({ op: 'list' }, fetcher)
      return {
        today: result.today,
        version: result.version ?? 2,
        plans: result.plans ?? [],
        schedules: result.schedules ?? [],
        projects: result.projects ?? [],
      }
    },
    async upsert(draft) {
      const result = await call<{ plan: TokenPlan; urgency: PlanUrgency }>({ op: 'upsert', draft }, fetcher)
      return { plan: result.plan, urgency: result.urgency }
    },
    async delete(id) {
      await call({ op: 'delete', id }, fetcher)
    },
    async contextSnapshot() {
      const result = await call<{ context: TimeMasterContextSnapshot }>({ op: 'contextSnapshot' }, fetcher)
      return result.context
    },
    async aiSuggest(hint) {
      const result = await call<{ draft: TokenPlanDraft; source: 'ai' | 'heuristic' }>({
        op: 'aiSuggest',
        ...(hint?.trim() ? { hint: hint.trim() } : {}),
      }, fetcher)
      return { draft: result.draft, source: result.source }
    },
    async scheduleList() {
      const result = await call<{ schedules: UsageSchedule[] }>({ op: 'schedule.list' }, fetcher)
      return { schedules: result.schedules ?? [] }
    },
    async scheduleUpsert(scheduleDraft) {
      const result = await call<{ schedule: UsageSchedule }>({ op: 'schedule.upsert', scheduleDraft }, fetcher)
      return { schedule: result.schedule }
    },
    async scheduleDelete(id) {
      await call({ op: 'schedule.delete', id }, fetcher)
    },
    async aiOrchestrateUsage(hint) {
      const result = await call<{ draft: UsageScheduleDraft; source: 'ai' | 'heuristic' }>({
        op: 'aiOrchestrateUsage',
        ...(hint?.trim() ? { hint: hint.trim() } : {}),
      }, fetcher)
      return { draft: result.draft, source: result.source }
    },
    async projectList() {
      const result = await call<{ projects: TimeMasterProjectView[] }>({ op: 'project.list' }, fetcher)
      return { projects: result.projects ?? [] }
    },
    async projectUpsert(projectDraft) {
      const result = await call<{ project: ProjectPlan }>({ op: 'project.upsert', projectDraft }, fetcher)
      return { project: result.project }
    },
    async projectDelete(id) {
      await call({ op: 'project.delete', id }, fetcher)
    },
    async aiPlanProject(hint) {
      const result = await call<{ draft: ProjectPlanDraft; source: 'ai' | 'heuristic' }>({
        op: 'aiPlanProject',
        ...(hint?.trim() ? { hint: hint.trim() } : {}),
      }, fetcher)
      return { draft: result.draft, source: result.source }
    },
    async coordSnapshot() {
      const result = await call<{ snapshot: CoordSnapshotView }>({ op: 'coord.snapshot' }, fetcher)
      return { snapshot: result.snapshot }
    },
    async aiCoordinate(options) {
      const result = await call<{
        suggestions: CoordSuggestion[]
        source: 'ai' | 'heuristic'
        snapshot: CoordSnapshotView
        applied: boolean
      }>({
        op: 'aiCoordinate',
        ...(options?.apply ? { applySuggestions: true } : {}),
      }, fetcher)
      return {
        suggestions: result.suggestions ?? [],
        source: result.source,
        snapshot: result.snapshot,
        applied: result.applied ?? false,
      }
    },
  }
}

export type { TokenPlanCycle }
export { TIME_MASTER_PATH }
