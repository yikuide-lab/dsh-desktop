/** Workspace / session helpers for workflow run parameters. */

import type { WorkflowView } from './desktop-workflow-api.js'

/** True when value looks like an absolute filesystem path. */
export function looksLikeAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)
}

/** Resolve a stable workspace id for binding (may not be a filesystem path). */
export function currentWorkspaceId(): string {
  try {
    const params = new URLSearchParams(window.location.search)
    return params.get('workspace')
      ?? params.get('cwd')
      ?? window.location.pathname
      ?? 'default'
  } catch {
    return 'default'
  }
}

/**
 * Best-effort absolute workspace root from the URL.
 * Prefer the session cwd passed into {@link buildRunParams} when available.
 */
export function currentWorkspaceRoot(): string | undefined {
  try {
    const params = new URLSearchParams(window.location.search)
    for (const key of ['cwd', 'workspaceRoot', 'workspace'] as const) {
      const value = params.get(key)
      if (value && looksLikeAbsolutePath(value)) return value
    }
  } catch {
    // ignore
  }
  return undefined
}

/** Minimal sessions-list shape used to resolve the active session cwd. */
export interface SessionCwdSource {
  readonly current?: string | undefined
  readonly byId: Readonly<Record<string, { readonly cwd?: string | undefined } | undefined>>
}

/** Absolute cwd of the current session, when the sessions store exposes one. */
export function pickCurrentSessionCwd(state: SessionCwdSource): string | undefined {
  const id = state.current
  if (!id) return undefined
  const cwd = state.byId[id]?.cwd
  return typeof cwd === 'string' && looksLikeAbsolutePath(cwd) ? cwd : undefined
}

/** Absolute cwd for a specific session id (composer / session-scoped slots). */
export function pickSessionCwd(
  state: SessionCwdSource,
  sessionId: string | undefined,
): string | undefined {
  if (!sessionId) return undefined
  const cwd = state.byId[sessionId]?.cwd
  return typeof cwd === 'string' && looksLikeAbsolutePath(cwd) ? cwd : undefined
}

/** Whether a workflow expects a PROBLEM / QUESTION / PROMPT run parameter. */
export function needsProblemParam(workflow: Pick<WorkflowView, 'name' | 'steps'>): boolean {
  if (
    workflow.name === 'multi-llm-problem-review'
    || workflow.name === 'multi-llm-coder'
  ) return true
  return workflow.steps.some((step) => {
    const prompt = typeof step.prompt === 'string' ? step.prompt : ''
    const run = typeof step.run === 'string' ? step.run : ''
    return prompt.includes('$PROBLEM')
      || prompt.includes('$PROMPT')
      || run.includes('$PROBLEM')
      || run.includes('$PROMPT')
      || run.includes('${PROBLEM')
      || run.includes('${PROMPT')
  })
}

/**
 * Build Host run params from a composer prompt.
 * `workspaceRoot` must be an absolute path when provided; otherwise Host falls
 * back to the current working directory instead of treating a URL path as a directory.
 */
export function buildRunParams(
  workspaceId: string,
  prompt?: string,
  workspaceRoot?: string,
): Record<string, string> {
  const root = (workspaceRoot && looksLikeAbsolutePath(workspaceRoot))
    ? workspaceRoot
    : currentWorkspaceRoot()

  const params: Record<string, string> = {
    workspaceId,
    sessionId: workspaceId,
  }
  if (root) params.workspaceRoot = root

  if (prompt) {
    params.PROMPT = prompt
    params.prompt = prompt
    params.PROBLEM = prompt
    params.problem = prompt
    params.QUESTION = prompt
    params.question = prompt
  }
  return params
}
