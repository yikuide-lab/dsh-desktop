/** Shared types for Time Master token-plan registry (V2). */

export type TokenPlanCycle = 'monthly' | 'yearly' | 'custom'

export interface TokenPlan {
  readonly id: string
  readonly name: string
  readonly providerHint?: string
  readonly cycle: TokenPlanCycle
  readonly startsAt?: string
  readonly expiresAt: string
  readonly remindDays: readonly number[]
  readonly notes?: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface TokenPlanDraft {
  readonly name?: string
  readonly providerHint?: string
  readonly cycle?: TokenPlanCycle
  readonly startsAt?: string
  readonly expiresAt?: string
  readonly remindDays?: readonly number[]
  readonly notes?: string
}

export type UsageScheduleRole = 'primary' | 'backup' | 'burst' | 'idle'

export interface UsageScheduleItem {
  readonly planId: string
  readonly role: UsageScheduleRole
  readonly windowStart: string
  readonly windowEnd: string
  readonly dailyBudgetHint?: string
  readonly notes?: string
}

export interface UsageSchedule {
  readonly id: string
  readonly name: string
  readonly horizonDays: number
  readonly items: UsageScheduleItem[]
  readonly rationale?: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface UsageScheduleDraft {
  readonly id?: string
  readonly name?: string
  readonly horizonDays?: number
  readonly items?: UsageScheduleItem[]
  readonly rationale?: string
}

export type ProjectTaskStatus = 'todo' | 'doing' | 'blocked' | 'done'

export interface ProjectTask {
  readonly id: string
  readonly title: string
  readonly status: ProjectTaskStatus
  readonly dueAt?: string
  readonly remindDays?: readonly number[]
  readonly estimateHours?: number
  readonly dependsOn?: readonly string[]
  readonly sessionId?: string
  readonly workflowName?: string
  readonly loopId?: string
  readonly planId?: string
  readonly notes?: string
}

export interface ProjectTaskDraft {
  readonly id?: string
  readonly title?: string
  readonly status?: ProjectTaskStatus
  readonly dueAt?: string
  readonly remindDays?: readonly number[]
  readonly estimateHours?: number
  readonly dependsOn?: readonly string[]
  readonly sessionId?: string
  readonly workflowName?: string
  readonly loopId?: string
  readonly planId?: string
  readonly notes?: string
}

export type ProjectPlanStatus = 'active' | 'paused' | 'done'

export interface ProjectPlan {
  readonly id: string
  readonly title: string
  readonly goal: string
  readonly status: ProjectPlanStatus
  readonly tasks: ProjectTask[]
  readonly createdAt: string
  readonly updatedAt: string
}

export interface ProjectPlanDraft {
  readonly id?: string
  readonly title?: string
  readonly goal?: string
  readonly status?: ProjectPlanStatus
  readonly tasks?: ProjectTaskDraft[]
}

export type CoordConflictCode = 'due_overlap' | 'session_overload' | 'plan_window_miss'

export interface CoordConflict {
  readonly code: CoordConflictCode
  readonly taskIds: readonly string[]
  readonly detail: string
}

export interface CoordSuggestion {
  readonly taskId: string
  readonly field: 'dueAt' | 'sessionId' | 'workflowName' | 'planId'
  readonly value: string
  readonly reason: string
}

export interface TimeMasterStoreFile {
  readonly version: 2
  readonly plans: TokenPlan[]
  readonly schedules: UsageSchedule[]
  readonly projects: ProjectPlan[]
  /** entityId → reminder keys already fired (prefixed plan:/task:/schedule:). */
  readonly remindersSent: Record<string, string[]>
}

export interface SessionSummary {
  readonly id: string
  readonly label?: string
}

export interface TimeMasterContextSnapshot {
  readonly providers: readonly { id: string; name: string; models: readonly string[] }[]
  readonly tokenPlanRoutes: readonly string[]
  readonly workflowProviders: readonly { id: string; model: string; host?: string }[]
  readonly templates: readonly { name: string; cycle: TokenPlanCycle; providerHint: string; notes: string }[]
  readonly today: string
  readonly sessions: readonly SessionSummary[]
  readonly workflowNames: readonly string[]
}

export const DEFAULT_REMIND_DAYS: readonly number[] = [7, 3, 1, 0]
export const DEFAULT_TASK_REMIND_DAYS: readonly number[] = [3, 1, 0]

export function isTokenPlanCycle(value: unknown): value is TokenPlanCycle {
  return value === 'monthly' || value === 'yearly' || value === 'custom'
}

export function isUsageScheduleRole(value: unknown): value is UsageScheduleRole {
  return value === 'primary' || value === 'backup' || value === 'burst' || value === 'idle'
}

export function isProjectTaskStatus(value: unknown): value is ProjectTaskStatus {
  return value === 'todo' || value === 'doing' || value === 'blocked' || value === 'done'
}

export function isProjectPlanStatus(value: unknown): value is ProjectPlanStatus {
  return value === 'active' || value === 'paused' || value === 'done'
}
