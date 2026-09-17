import type { DesktopWorkflowApi, WorkflowRunView } from './desktop-workflow-api.js'

/** List currently running workflow runs (newest first from API order). */
export async function listActiveRuns(api: DesktopWorkflowApi): Promise<WorkflowRunView[]> {
  const runs = await api.listRuns()
  return runs.filter((run) => run.status === 'running')
}

/** Find one active run (compatibility helper; prefer {@link listActiveRuns}). */
export async function findActiveRun(api: DesktopWorkflowApi): Promise<WorkflowRunView | null> {
  const active = await listActiveRuns(api)
  return active[0] ?? null
}

/**
 * Ensure capacity for another concurrent run.
 * When at the active-run limit, ask to stop the oldest running run first.
 * Returns false when the user declines.
 */
export async function ensureActiveRunCapacity(input: {
  api: DesktopWorkflowApi
  confirmStop: (message: string) => boolean
  atCapacityMessage: string
  /** Must match Host WorkflowPluginConfig.maxActiveRuns (default 4). */
  maxActiveRuns?: number
}): Promise<boolean> {
  const limit = input.maxActiveRuns ?? 4
  const active = await listActiveRuns(input.api)
  if (active.length < limit) return true
  if (!input.confirmStop(input.atCapacityMessage)) return false
  const oldest = [...active].sort((a, b) => (
    String(a.startedAt ?? '').localeCompare(String(b.startedAt ?? ''))
  ))[0]
  if (oldest) await input.api.stopRun(oldest.id)
  return true
}

/**
 * @deprecated Use {@link ensureActiveRunCapacity}. Kept for call-site migration.
 */
export async function ensureNoActiveRun(input: {
  api: DesktopWorkflowApi
  confirmStop: (message: string) => boolean
  alreadyActiveMessage: string
}): Promise<boolean> {
  return ensureActiveRunCapacity({
    api: input.api,
    confirmStop: input.confirmStop,
    atCapacityMessage: input.alreadyActiveMessage,
  })
}
