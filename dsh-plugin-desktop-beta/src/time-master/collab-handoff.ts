/** Bind a Collab Loop id onto project tasks for Time Master handoff (V2.3). */

import type { ProjectTask, ProjectTaskDraft } from './types.js'

/**
 * Attach `loopId` to the first unbound active task, or to every unbound task
 * when `allUnbound` is true. Returns a new array (does not mutate input).
 */
export function bindLoopIdToProjectTasks<T extends ProjectTask | ProjectTaskDraft>(
  tasks: readonly T[],
  loopId: string,
  options?: { allUnbound?: boolean },
): T[] {
  const id = loopId.trim()
  if (!id) return tasks.map((task) => ({ ...task }))
  const allUnbound = options?.allUnbound === true
  let boundOnce = false
  return tasks.map((task) => {
    if (task.loopId?.trim()) return { ...task }
    const status = task.status ?? 'todo'
    if (status === 'done') return { ...task }
    if (!allUnbound && boundOnce) return { ...task }
    boundOnce = true
    return { ...task, loopId: id }
  })
}
