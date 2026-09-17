import type { WorkflowRecommendCandidate } from './workflow-recommend-candidates.js'

type Listener = () => void

/** Composer-armed workflow candidate (mutually exclusive with plain model chat on submit). */
let armed: WorkflowRecommendCandidate | null = null
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** Read the currently armed recommend candidate, if any. */
export function getArmedWorkflow(): WorkflowRecommendCandidate | null {
  return armed
}

/** Arm or clear the workflow that will own the next composer submit. */
export function setArmedWorkflow(next: WorkflowRecommendCandidate | null): void {
  armed = next
  emit()
}

/** Subscribe to armed-workflow changes (for useSyncExternalStore). */
export function subscribeArmedWorkflow(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
