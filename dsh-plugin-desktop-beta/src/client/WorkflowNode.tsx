import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { CanvasNodeData } from './workflow-canvas-layout.js'

export type WorkflowFlowNode = Node<CanvasNodeData, 'workflow'>

/** Custom React Flow node for a workflow step. */
export function WorkflowCanvasNode(props: NodeProps & { data: CanvasNodeData }) {
  const { data, selected } = props
  return (
    <div className={`workflow-flow-node type-${data.stepType}${selected ? ' selected' : ''}${data.unsupported ? ' unsupported' : ''}`}>
      <Handle type="target" position={Position.Left} className="workflow-flow-handle" />
      <div className="workflow-flow-node-type">{data.stepType}</div>
      <div className="workflow-flow-node-id">{data.label}</div>
      {data.detail && (
        <div className="workflow-flow-node-detail">{data.detail}</div>
      )}
      <Handle type="source" position={Position.Right} className="workflow-flow-handle" />
    </div>
  )
}
