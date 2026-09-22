import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { CanvasNodeData } from './workflow-canvas-layout.js'
import { formatDuration } from './workflow-run-graph.js'

export type WorkflowFlowNode = Node<CanvasNodeData, 'workflow'>

/** Custom React Flow node for a workflow step (designer + live run graph). */
export function WorkflowCanvasNode(props: NodeProps & { data: CanvasNodeData }) {
  const { data, selected } = props
  const runStatus = data.runStatus
  const duration = formatDuration(data.durationMs)
  const attempts = data.attempts !== undefined && data.attempts > 1 ? data.attempts : undefined
  return (
    <div
      className={[
        'workflow-flow-node',
        `type-${data.stepType}`,
        selected ? 'selected' : '',
        data.unsupported ? 'unsupported' : '',
        runStatus ? `run-${runStatus}` : '',
        // Re-trigger the pop/flash animation when the status class appears.
        runStatus === 'completed' ? 'just-completed' : '',
        runStatus === 'failed' ? 'just-failed' : '',
      ].filter(Boolean).join(' ')}
    >
      <Handle type="target" position={Position.Left} className="workflow-flow-handle" />
      {runStatus && (
        <span className={`workflow-flow-node-dot run-${runStatus}`} aria-hidden="true" />
      )}
      <div className="workflow-flow-node-type">
        {data.stepType}
        {attempts ? <span className="workflow-flow-node-attempts">×{attempts}</span> : null}
      </div>
      <div className="workflow-flow-node-id">{data.label}</div>
      {data.detail && (
        <div className="workflow-flow-node-detail">{data.detail}</div>
      )}
      {duration && (
        <div className="workflow-flow-node-duration">{duration}</div>
      )}
      <Handle type="source" position={Position.Right} className="workflow-flow-handle" />
    </div>
  )
}
