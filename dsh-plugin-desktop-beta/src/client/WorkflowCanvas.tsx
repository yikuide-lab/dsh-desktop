import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type OnSelectionChangeParams,
} from '@xyflow/react'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import type { DesktopWorkflowApi, WorkflowStepType } from './desktop-workflow-api.js'
import type { WorkflowStep } from './workflow-store.js'
import { WorkflowCanvasNode, type WorkflowFlowNode } from './WorkflowNode.js'
import { WorkflowNodePalette } from './WorkflowNodePalette.js'
import { WorkflowStepInspector } from './WorkflowStepInspector.js'
import {
  allocateStepId,
  connectSteps,
  createBlankStep,
  disconnectSteps,
  removeStep,
  renameStepId,
  stepsToGraph,
  updateStep,
  updateStepPositions,
} from './workflow-canvas-layout.js'

const nodeTypes = { workflow: WorkflowCanvasNode }

interface WorkflowCanvasProps {
  steps: WorkflowStep[]
  /** Required when editing; ignored in read-only preview. */
  onStepsChange?: (steps: WorkflowStep[]) => void
  t: (key: WorkflowLocaleKey) => string
  onCycleRejected?: () => void
  /** Hide palette/inspector and disable graph mutations (pan/zoom still work). */
  readOnly?: boolean
  /** Enables LLM provider/model picker in the step inspector. */
  api?: DesktopWorkflowApi
}

function toFlowNodes(steps: WorkflowStep[]): WorkflowFlowNode[] {
  const { nodes } = stepsToGraph(steps)
  return nodes.map((node) => ({
    id: node.id,
    type: 'workflow' as const,
    position: node.position,
    data: node.data,
  }))
}

function toFlowEdges(steps: WorkflowStep[]): Edge[] {
  const { edges } = stepsToGraph(steps)
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
  }))
}

function WorkflowCanvasInner({
  steps,
  onStepsChange,
  t,
  onCycleRejected,
  readOnly = false,
  api,
}: WorkflowCanvasProps) {
  const { screenToFlowPosition } = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState(toFlowNodes(steps) as Node[])
  const [edges, setEdges, onEdgesChange] = useEdgesState(toFlowEdges(steps))
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)

  const commitSteps = useCallback((next: WorkflowStep[]) => {
    if (readOnly) return
    onStepsChange?.(next)
  }, [readOnly, onStepsChange])

  // Sync from parent steps when the document changes outside the canvas (YAML, etc.).
  // Do not depend on selectedStepId: rebuilding nodes on selection clears React Flow's
  // selection and immediately empties the inspector.
  useEffect(() => {
    setNodes(toFlowNodes(steps).map((node) => ({
      ...node,
      selected: selectedStepId != null && node.id === selectedStepId,
    })) as Node[])
    setEdges(toFlowEdges(steps))
    if (selectedStepId && !steps.some((step) => step.id === selectedStepId)) {
      setSelectedStepId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selection must not rebuild the graph
  }, [steps, setNodes, setEdges])

  const selectedStep = useMemo(
    () => steps.find((step) => step.id === selectedStepId) ?? null,
    [steps, selectedStepId],
  )

  const commitPositions = useCallback((nextNodes: Node[]) => {
    if (readOnly) return
    const positions = new Map<string, { x: number; y: number }>()
    for (const node of nextNodes) {
      positions.set(node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) })
    }
    commitSteps(updateStepPositions(steps, positions))
  }, [commitSteps, steps, readOnly])

  const onNodeDragStop = useCallback((_event: ReactMouseEvent, _node: Node, nextNodes: Node[]) => {
    commitPositions(nextNodes)
  }, [commitPositions]) as never

  const onConnect = useCallback((connection: Connection) => {
    if (readOnly || !connection.source || !connection.target) return
    const next = connectSteps(steps, connection.source, connection.target)
    if (!next) {
      onCycleRejected?.()
      return
    }
    commitSteps(next)
    setEdges((current) => addEdge({ ...connection, id: `${connection.source}->${connection.target}` }, current))
  }, [steps, commitSteps, onCycleRejected, setEdges, readOnly])

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    if (readOnly) return
    let next = steps
    for (const edge of deleted) {
      next = disconnectSteps(next, edge.source, edge.target)
    }
    commitSteps(next)
  }, [steps, commitSteps, readOnly])

  const onNodesDelete = useCallback((deleted: Node[]) => {
    if (readOnly) return
    let next = steps
    for (const node of deleted) {
      next = removeStep(next, node.id)
    }
    commitSteps(next)
    setSelectedStepId(null)
  }, [steps, commitSteps, readOnly])

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    const id = params.nodes[0]?.id ?? null
    setSelectedStepId(id)
  }, [])

  const addStepOfType = useCallback((type: WorkflowStepType, position?: { x: number; y: number }) => {
    if (readOnly) return
    const id = allocateStepId(steps)
    const blank = createBlankStep(type, id)
    const withUi: WorkflowStep = {
      ...blank,
      ui: position ?? { x: 80 + steps.length * 24, y: 80 + steps.length * 24 },
    }
    commitSteps([...steps, withUi])
    setSelectedStepId(id)
  }, [steps, commitSteps, readOnly])

  const onDragOver = useCallback((event: DragEvent) => {
    if (readOnly) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [readOnly])

  const onDrop = useCallback((event: DragEvent) => {
    if (readOnly) return
    event.preventDefault()
    const type = event.dataTransfer.getData('application/workflow-node-type') as WorkflowStepType
    if (!type) return
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    addStepOfType(type, { x: Math.round(position.x), y: Math.round(position.y) })
  }, [screenToFlowPosition, addStepOfType, readOnly])

  const handleInspectorChange = useCallback((
    stepId: string,
    patch: { [K in keyof WorkflowStep]?: WorkflowStep[K] | undefined },
  ) => {
    commitSteps(updateStep(steps, stepId, patch))
  }, [steps, commitSteps])

  const handleRename = useCallback((oldId: string, newId: string) => {
    const next = renameStepId(steps, oldId, newId)
    if (!next) return
    commitSteps(next)
    if (newId.trim() && newId.trim() !== oldId) setSelectedStepId(newId.trim())
  }, [steps, commitSteps])

  const handleDelete = useCallback((stepId: string) => {
    commitSteps(removeStep(steps, stepId))
    setSelectedStepId(null)
  }, [steps, commitSteps])

  return (
    <div className={`workflow-canvas-shell${readOnly ? ' is-readonly' : ''}`}>
      {!readOnly && (
        <WorkflowNodePalette t={t} onAdd={(type) => addStepOfType(type)} />
      )}
      <div className="workflow-canvas-stage" onDragOver={onDragOver} onDrop={onDrop}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes as never}
          {...(readOnly ? {} : {
            onNodesChange,
            onEdgesChange,
            onConnect,
            onEdgesDelete,
            onNodesDelete,
            onNodeDragStop,
          })}
          onSelectionChange={onSelectionChange}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable
          edgesReconnectable={!readOnly}
          fitView
          deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} size={1} />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      {!readOnly && (
        <WorkflowStepInspector
          step={selectedStep}
          t={t}
          onChange={handleInspectorChange}
          onRename={handleRename}
          onDelete={handleDelete}
          {...(api ? { api } : {})}
        />
      )}
      {readOnly && selectedStep && (
        <aside className="workflow-canvas-inspector workflow-canvas-inspector-readonly">
          <h4>{t('canvasInspector')}</h4>
          <dl className="workflow-preview-step-meta">
            <div>
              <dt>{t('canvasStepId')}</dt>
              <dd><code>{selectedStep.id}</code></dd>
            </div>
            <div>
              <dt>{t('canvasStepType')}</dt>
              <dd>{selectedStep.type}</dd>
            </div>
            {selectedStep.role && (
              <div>
                <dt>{t('previewStepRole')}</dt>
                <dd>{selectedStep.role}</dd>
              </div>
            )}
            {selectedStep.model && (
              <div>
                <dt>{t('previewStepModel')}</dt>
                <dd><code>{selectedStep.model}</code></dd>
              </div>
            )}
            {selectedStep.deps && selectedStep.deps.length > 0 && (
              <div>
                <dt>{t('previewStepDeps')}</dt>
                <dd>{selectedStep.deps.join(', ')}</dd>
              </div>
            )}
            {(selectedStep.run || selectedStep.prompt || selectedStep.question || selectedStep.ref) && (
              <div>
                <dt>{t('previewStepDetail')}</dt>
                <dd className="workflow-preview-step-detail">
                  {selectedStep.run || selectedStep.prompt || selectedStep.question || selectedStep.ref}
                </dd>
              </div>
            )}
            {selectedStep.type === 'sub_workflow' && (
              <div>
                <dt>{t('stepSubWorkflow')}</dt>
                <dd>{selectedStep.ref || t('subWorkflowHint')}</dd>
              </div>
            )}
          </dl>
          <p className="workflow-canvas-inspector-empty">{t('previewReadOnlyHint')}</p>
        </aside>
      )}
    </div>
  )
}

/** Canvas designer: palette + React Flow DAG + step inspector (or read-only preview). */
export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
