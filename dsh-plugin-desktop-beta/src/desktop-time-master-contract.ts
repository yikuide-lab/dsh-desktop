/** Contract for the private Desktop Time Master HTTP bridge. */

export const DESKTOP_TIME_MASTER_PATH = '/api/desktop/time-master'

export type DesktopTimeMasterOp =
  | 'list'
  | 'upsert'
  | 'delete'
  | 'contextSnapshot'
  | 'aiSuggest'
  | 'schedule.list'
  | 'schedule.upsert'
  | 'schedule.delete'
  | 'aiOrchestrateUsage'
  | 'project.list'
  | 'project.upsert'
  | 'project.delete'
  | 'aiPlanProject'
  | 'coord.snapshot'
  | 'aiCoordinate'

export interface DesktopTimeMasterRequest {
  readonly op: DesktopTimeMasterOp
  readonly id?: string
  readonly draft?: {
    id?: string
    name?: string
    providerHint?: string
    cycle?: 'monthly' | 'yearly' | 'custom'
    startsAt?: string
    expiresAt?: string
    remindDays?: number[]
    notes?: string
  }
  readonly scheduleDraft?: {
    id?: string
    name?: string
    horizonDays?: number
    items?: {
      planId: string
      role: 'primary' | 'backup' | 'burst' | 'idle'
      windowStart: string
      windowEnd: string
      dailyBudgetHint?: string
      notes?: string
    }[]
    rationale?: string
  }
  readonly projectDraft?: {
    id?: string
    title?: string
    goal?: string
    status?: 'active' | 'paused' | 'done'
    tasks?: {
      id?: string
      title?: string
      status?: 'todo' | 'doing' | 'blocked' | 'done'
      dueAt?: string
      remindDays?: number[]
      estimateHours?: number
      dependsOn?: string[]
      sessionId?: string
      workflowName?: string
      loopId?: string
      planId?: string
      notes?: string
    }[]
  }
  readonly applySuggestions?: boolean
  readonly hint?: string
}

export interface DesktopTimeMasterErrorResponse {
  readonly ok: false
  readonly error: string
}
