/**
 * Linear undo/redo stack for AI (and other) workflow draft snapshots.
 * Applying a new revision while not at the tip truncates the redo branch.
 */

export interface WorkflowDesignRevision {
  readonly id: string
  readonly yaml: string
  readonly label: string
  readonly prompt?: string
  readonly createdAt: string
}

export interface WorkflowDesignHistoryState {
  readonly revisions: readonly WorkflowDesignRevision[]
  /** Index of the currently restored revision; -1 when empty. */
  readonly index: number
}

export function createDesignHistory(): WorkflowDesignHistoryState {
  return { revisions: [], index: -1 }
}

export function currentDesignRevision(
  state: WorkflowDesignHistoryState,
): WorkflowDesignRevision | null {
  if (state.index < 0 || state.index >= state.revisions.length) return null
  return state.revisions[state.index] ?? null
}

export function canDesignUndo(state: WorkflowDesignHistoryState): boolean {
  return state.index > 0
}

export function canDesignRedo(state: WorkflowDesignHistoryState): boolean {
  return state.index >= 0 && state.index < state.revisions.length - 1
}

/** Seed history with the editor baseline before the first AI apply (idempotent if already seeded). */
export function ensureDesignBaseline(
  state: WorkflowDesignHistoryState,
  yaml: string,
  label: string,
): WorkflowDesignHistoryState {
  if (state.revisions.length > 0) return state
  const trimmed = yaml.trim()
  if (!trimmed) return state
  const revision: WorkflowDesignRevision = {
    id: `rev-baseline-${Date.now().toString(36)}`,
    yaml: trimmed,
    label,
    createdAt: new Date().toISOString(),
  }
  return { revisions: [revision], index: 0 }
}

/** Push a new applied revision; drops any redo branch beyond the current index. */
export function pushDesignRevision(
  state: WorkflowDesignHistoryState,
  input: { yaml: string; label: string; prompt?: string },
): WorkflowDesignHistoryState {
  const yaml = input.yaml.trim()
  if (!yaml) return state
  const kept = state.index >= 0 ? state.revisions.slice(0, state.index + 1) : []
  const last = kept[kept.length - 1]
  if (last && last.yaml === yaml) {
    return { revisions: kept, index: kept.length - 1 }
  }
  const revision: WorkflowDesignRevision = {
    id: `rev-${Date.now().toString(36)}-${kept.length}`,
    yaml,
    label: input.label,
    ...(input.prompt ? { prompt: input.prompt } : {}),
    createdAt: new Date().toISOString(),
  }
  const revisions = [...kept, revision]
  return { revisions, index: revisions.length - 1 }
}

export function undoDesignRevision(
  state: WorkflowDesignHistoryState,
): WorkflowDesignHistoryState {
  if (!canDesignUndo(state)) return state
  return { ...state, index: state.index - 1 }
}

export function redoDesignRevision(
  state: WorkflowDesignHistoryState,
): WorkflowDesignHistoryState {
  if (!canDesignRedo(state)) return state
  return { ...state, index: state.index + 1 }
}

/** Jump to an arbitrary revision index (for history list). */
export function jumpDesignRevision(
  state: WorkflowDesignHistoryState,
  index: number,
): WorkflowDesignHistoryState {
  if (index < 0 || index >= state.revisions.length) return state
  return { ...state, index }
}
