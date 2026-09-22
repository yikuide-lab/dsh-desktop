/**
 * Pure helpers for the workflow RUN graph: merge live run state onto the
 * designer DAG, normalize node statuses, and pick animated edges.
 */

import type { RunStepView, WorkflowStepView } from './desktop-workflow-api.js'
import type {
  CanvasGraphEdge,
  CanvasGraphNode,
  RunNodeStatus,
} from './workflow-canvas-layout.js'
import { stepsToGraph } from './workflow-canvas-layout.js'

export type { RunNodeStatus }

/**
 * Normalize a UI step status plus its pending gate into a node status.
 * `waiting` marks an approval step that is ready but unresolved.
 */
export function runStatusClass(
  status: string,
  options: { hasPendingGate?: boolean } = {},
): RunNodeStatus {
  if (options.hasPendingGate && (status === 'pending' || status === 'running')) {
    return 'waiting'
  }
  switch (status) {
    case 'running':
    case 'completed':
    case 'failed':
    case 'skipped':
    case 'aborted':
      return status
    default:
      return 'pending'
  }
}

export interface RunGraphResult {
  nodes: CanvasGraphNode[]
  edges: CanvasGraphEdge[]
}

/**
 * Build React Flow nodes/edges for a live run.
 * Positions and edges come from the workflow definition (`ui:{x,y}` + `deps`);
 * live status/attempts/duration come from the run's step views.
 */
export function buildRunGraph(
  workflowSteps: readonly WorkflowStepView[],
  runSteps: readonly RunStepView[],
  options: { pendingGateStepIds?: ReadonlySet<string> } = {},
): RunGraphResult {
  const { nodes, edges } = stepsToGraph(workflowSteps)
  const runById = new Map(runSteps.map((step) => [step.id, step]))
  const pendingGateStepIds = options.pendingGateStepIds ?? new Set<string>()

  const annotated: CanvasGraphNode[] = nodes.map((node) => {
    const live = runById.get(node.id)
    if (!live) return node
    const status = runStatusClass(live.status, {
      hasPendingGate: pendingGateStepIds.has(node.id),
    })
    return {
      ...node,
      data: {
        ...node.data,
        runStatus: status,
        ...(live.attempt !== undefined ? { attempts: live.attempt } : {}),
        ...(live.durationMs !== undefined ? { durationMs: live.durationMs } : {}),
      },
    }
  })

  return { nodes: annotated, edges }
}

/**
 * Edge ids whose source finished and target is now running — the "hot path"
 * that carries the flow animation. Terminal edges stay static.
 */
export function activeEdgeIds(
  nodes: readonly CanvasGraphNode[],
  edges: readonly CanvasGraphEdge[],
): string[] {
  const statusById = new Map(
    nodes.map((node) => [node.id, node.data.runStatus ?? 'pending'] as const),
  )
  const active: string[] = []
  for (const edge of edges) {
    const source = statusById.get(edge.source)
    const target = statusById.get(edge.target)
    if ((source === 'completed' || source === 'skipped') && target === 'running') {
      active.push(edge.id)
    }
  }
  return active
}

/** Edge ids whose target failed — painted red so the failure path is obvious. */
export function failedEdgeIds(
  nodes: readonly CanvasGraphNode[],
  edges: readonly CanvasGraphEdge[],
): string[] {
  const statusById = new Map(
    nodes.map((node) => [node.id, node.data.runStatus ?? 'pending'] as const),
  )
  const failed: string[] = []
  for (const edge of edges) {
    if (statusById.get(edge.target) === 'failed') failed.push(edge.id)
  }
  return failed
}

/** Format a duration in ms as a compact human string (e.g. 820ms, 3.4s, 2m 05s). */
export function formatDuration(durationMs: number | undefined): string | undefined {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return undefined
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`
  const seconds = durationMs / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds - minutes * 60)
  return `${minutes}m ${String(rest).padStart(2, '0')}s`
}

/** Node id to auto-focus: the first running step, else the first waiting gate. */
export function focusNodeId(nodes: readonly CanvasGraphNode[]): string | undefined {
  return (
    nodes.find((node) => node.data.runStatus === 'running')?.id
    ?? nodes.find((node) => node.data.runStatus === 'waiting')?.id
  )
}
