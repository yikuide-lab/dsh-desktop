/**
 * Pure helpers for the canvas workflow designer: layout, deps edges, cycle checks.
 */

import type { WorkflowStepType, WorkflowStepView } from './desktop-workflow-api.js'

export const CANVAS_NODE_WIDTH = 180
export const CANVAS_NODE_HEIGHT = 72
export const CANVAS_LAYER_GAP_X = 240
export const CANVAS_LAYER_GAP_Y = 110

export interface CanvasNodeData {
  [key: string]: unknown
  stepId: string
  stepType: WorkflowStepType
  label: string
  /** Subtitle shown under the step id (e.g. sub_workflow ref). */
  detail?: string
  unsupported?: boolean
  /** Live run status for execution visualization ('' when the canvas is not a run). */
  runStatus?: RunNodeStatus
  /** Highest execute attempt seen for the step. */
  attempts?: number
  /** Wall-clock step duration in ms once terminal. */
  durationMs?: number
}

/** Normalized node status used by the run graph + status animations. */
export type RunNodeStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'waiting'
  | 'aborted'

export interface CanvasGraphNode {
  id: string
  position: { x: number; y: number }
  data: CanvasNodeData
}

export interface CanvasGraphEdge {
  id: string
  source: string
  target: string
}

/** Allocate a unique step id like step-1, step-2, … */
export function allocateStepId(steps: readonly WorkflowStepView[], prefix = 'step'): string {
  const taken = new Set(steps.map((step) => step.id))
  let index = steps.length + 1
  let candidate = `${prefix}-${index}`
  while (taken.has(candidate)) {
    index += 1
    candidate = `${prefix}-${index}`
  }
  return candidate
}

/** Create a blank step of the given type for the palette. */
export function createBlankStep(type: WorkflowStepType, id: string): WorkflowStepView {
  const step: WorkflowStepView = { id, type }
  if (type === 'script') step.run = 'echo hello'
  if (type === 'llm') step.prompt = 'Describe the next action.'
  if (type === 'approval') {
    step.question = 'Approve?'
    step.options = ['approved', 'rejected']
  }
  if (type === 'sub_workflow') step.ref = 'other-workflow'
  if (type === 'task') step.role = 'implement'
  return step
}

/**
 * Layered auto-layout by dependency depth (roots at the left).
 * Steps with explicit ui positions keep them; others get placed by layer.
 */
export function autoLayoutSteps(steps: readonly WorkflowStepView[]): WorkflowStepView[] {
  const ids = new Set(steps.map((step) => step.id))
  const depth = new Map<string, number>()

  const visit = (id: string, stack: Set<string>): number => {
    const cached = depth.get(id)
    if (cached !== undefined) return cached
    if (stack.has(id)) return 0
    stack.add(id)
    const step = steps.find((entry) => entry.id === id)
    const deps = (step?.deps ?? []).filter((dep) => ids.has(dep))
    const layer = deps.length === 0
      ? 0
      : Math.max(...deps.map((dep) => visit(dep, stack))) + 1
    stack.delete(id)
    depth.set(id, layer)
    return layer
  }

  for (const step of steps) visit(step.id, new Set())

  const columns = new Map<number, string[]>()
  for (const step of steps) {
    const layer = depth.get(step.id) ?? 0
    const list = columns.get(layer) ?? []
    list.push(step.id)
    columns.set(layer, list)
  }

  const positions = new Map<string, { x: number; y: number }>()
  for (const [layer, column] of columns) {
    column.forEach((id, index) => {
      positions.set(id, {
        x: 40 + layer * CANVAS_LAYER_GAP_X,
        y: 40 + index * CANVAS_LAYER_GAP_Y,
      })
    })
  }

  return steps.map((step) => {
    if (step.ui && Number.isFinite(step.ui.x) && Number.isFinite(step.ui.y)) return step
    const pos = positions.get(step.id) ?? { x: 40, y: 40 }
    return { ...step, ui: pos }
  })
}

/** Build React Flow nodes/edges from steps. Source→target means target.deps includes source. */
export function stepsToGraph(steps: readonly WorkflowStepView[]): {
  nodes: CanvasGraphNode[]
  edges: CanvasGraphEdge[]
} {
  const laidOut = autoLayoutSteps(steps)
  const nodes: CanvasGraphNode[] = laidOut.map((step) => ({
    id: step.id,
    position: { x: step.ui?.x ?? 40, y: step.ui?.y ?? 40 },
    data: {
      stepId: step.id,
      stepType: step.type,
      label: step.id,
      ...(step.type === 'sub_workflow' && step.ref ? { detail: step.ref } : {}),
    },
  }))

  const edges: CanvasGraphEdge[] = []
  const idSet = new Set(steps.map((step) => step.id))
  for (const step of steps) {
    for (const dep of step.deps ?? []) {
      if (!idSet.has(dep)) continue
      edges.push({
        id: `${dep}->${step.id}`,
        source: dep,
        target: step.id,
      })
    }
  }

  return { nodes, edges }
}

/** Return true if adding edge source→target would create a cycle in the dep graph. */
export function wouldCreateCycle(
  steps: readonly WorkflowStepView[],
  sourceId: string,
  targetId: string,
): boolean {
  if (sourceId === targetId) return true
  // Edge source→target means target.deps includes source.
  // Cycle if we can already walk source→…→target along existing edges.
  const adj = new Map<string, string[]>()
  for (const step of steps) {
    for (const dep of step.deps ?? []) {
      const list = adj.get(dep) ?? []
      list.push(step.id)
      adj.set(dep, list)
    }
  }
  const stack = [targetId]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === sourceId) return true
    if (seen.has(current)) continue
    seen.add(current)
    for (const next of adj.get(current) ?? []) stack.push(next)
  }
  return false
}

/** Add a dependency edge (source must complete before target). */
export function connectSteps(
  steps: readonly WorkflowStepView[],
  sourceId: string,
  targetId: string,
): WorkflowStepView[] | null {
  if (!steps.some((step) => step.id === sourceId)) return null
  if (!steps.some((step) => step.id === targetId)) return null
  if (wouldCreateCycle(steps, sourceId, targetId)) return null

  return steps.map((step) => {
    if (step.id !== targetId) return step
    const deps = step.deps ?? []
    if (deps.includes(sourceId)) return step
    return { ...step, deps: [...deps, sourceId] }
  })
}

/** Remove a dependency edge. */
export function disconnectSteps(
  steps: readonly WorkflowStepView[],
  sourceId: string,
  targetId: string,
): WorkflowStepView[] {
  return steps.map((step) => {
    if (step.id !== targetId || !step.deps?.includes(sourceId)) return step
    const deps = step.deps.filter((dep) => dep !== sourceId)
    if (deps.length === 0) {
      const { deps: _removed, ...rest } = step
      return rest
    }
    return { ...step, deps }
  })
}

/** Remove a step and scrub its id from all deps. */
export function removeStep(
  steps: readonly WorkflowStepView[],
  stepId: string,
): WorkflowStepView[] {
  return steps
    .filter((step) => step.id !== stepId)
    .map((step) => {
      if (!step.deps?.includes(stepId)) return step
      const deps = step.deps.filter((dep) => dep !== stepId)
      if (deps.length === 0) {
        const { deps: _removed, ...rest } = step
        return rest
      }
      return { ...step, deps }
    })
}

/** Rename a step id and rewrite deps references. */
export function renameStepId(
  steps: readonly WorkflowStepView[],
  oldId: string,
  newId: string,
): WorkflowStepView[] | null {
  const trimmed = newId.trim()
  if (!trimmed || trimmed === oldId) return [...steps]
  if (steps.some((step) => step.id === trimmed)) return null

  return steps.map((step) => {
    const next: WorkflowStepView = {
      ...step,
      id: step.id === oldId ? trimmed : step.id,
    }
    if (step.deps?.includes(oldId)) {
      next.deps = step.deps.map((dep) => (dep === oldId ? trimmed : dep))
    }
    return next
  })
}

/** Persist dragged node positions onto steps. */
export function updateStepPositions(
  steps: readonly WorkflowStepView[],
  positions: ReadonlyMap<string, { x: number; y: number }>,
): WorkflowStepView[] {
  return steps.map((step) => {
    const pos = positions.get(step.id)
    if (!pos) return step
    return { ...step, ui: { x: pos.x, y: pos.y } }
  })
}

/** Patch a single step by id. Explicit `undefined` removes the property. */
export function updateStep(
  steps: readonly WorkflowStepView[],
  stepId: string,
  patch: { [K in keyof WorkflowStepView]?: WorkflowStepView[K] | undefined },
): WorkflowStepView[] {
  return steps.map((step) => {
    if (step.id !== stepId) return step
    const next: WorkflowStepView = { ...step, id: step.id }
    for (const key of Object.keys(patch) as (keyof WorkflowStepView)[]) {
      if (!(key in patch)) continue
      const value = patch[key]
      if (value === undefined) {
        delete (next as unknown as Record<string, unknown>)[key]
      } else {
        ;(next as unknown as Record<string, unknown>)[key] = value
      }
    }
    return next
  })
}
