import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  type NodeChange,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
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

/** Topology + positions — property text edits must not trigger a full node replace. */
function canvasStructureKey(steps: readonly WorkflowStep[]): string {
  return steps.map((step) => (
    `${step.id}\0${step.type}\0${(step.deps ?? []).join(',')}\0${step.ui?.x ?? ''},${step.ui?.y ?? ''}`
  )).join('\n')
}

function applySelection(nodes: WorkflowFlowNode[], selectedStepId: string | null): Node[] {
  return nodes.map((node) => ({
    ...node,
    selected: selectedStepId != null && node.id === selectedStepId,
  })) as Node[]
}

function isInspectorTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('.workflow-canvas-inspector')) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
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
  const selectedStepIdRef = useRef<string | null>(null)
  const structureKeyRef = useRef(canvasStructureKey(steps))
  const didFitRef = useRef(false)

  selectedStepIdRef.current = selectedStepId

  const commitSteps = useCallback((next: WorkflowStep[]) => {
    if (readOnly) return
    onStepsChange?.(next)
  }, [readOnly, onStepsChange])

  const structureKey = useMemo(() => canvasStructureKey(steps), [steps])

  // Sync graph from parent. Full replace only on topology/position changes;
  // property edits only refresh node.data so React Flow does not drop selection.
  useEffect(() => {
    const selected = selectedStepIdRef.current
    if (structureKey !== structureKeyRef.current) {
      structureKeyRef.current = structureKey
      setNodes(applySelection(toFlowNodes(steps), selected))
      setEdges(toFlowEdges(steps))
    } else {
      const dataById = new Map(toFlowNodes(steps).map((node) => [node.id, node.data]))
      setNodes((current) => current.map((node) => {
        const data = dataById.get(node.id)
        if (!data) return node
        return {
          ...node,
          data,
          selected: selected != null && node.id === selected,
        }
      }))
    }
    if (selected && !steps.some((step) => step.id === selected)) {
      setSelectedStepId(null)
    }
  }, [steps, structureKey, setNodes, setEdges])

  const selectedStep = useMemo(
    () => steps.find((step) => step.id === selectedStepId) ?? null,
    [steps, selectedStepId],
  )

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    const locked = selectedStepIdRef.current
    const filtered = changes.filter((change) => {
      // Keep the inspector's step selected across controlled node updates.
      if (change.type === 'select' && locked && change.id === locked && change.selected === false) {
        return false
      }
      return true
    })
    if (filtered.length > 0) onNodesChange(filtered)
  }, [onNodesChange])

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

  const onBeforeDelete = useCallback(async () => {
    if (isInspectorTypingTarget(document.activeElement)) return false
    return true
  }, [])

  const onNodeClick = useCallback((_event: ReactMouseEvent, node: Node) => {
    setSelectedStepId(node.id)
  }, [])

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    const id = params.nodes.find((node) => node.selected)?.id ?? params.nodes[0]?.id ?? null
    // Ignore empty selection events from node rebuilds — pane clears via onPaneClick.
    if (id) setSelectedStepId(id)
  }, [])

  const onPaneClick = useCallback(() => {
    setSelectedStepId(null)
  }, [])

  const onInit = useCallback((instance: ReactFlowInstance) => {
    if (didFitRef.current) return
    didFitRef.current = true
    void instance.fitView({ padding: 0.2 })
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
            onNodesChange: handleNodesChange,
            onEdgesChange,
            onConnect,
            onEdgesDelete,
            onNodesDelete,
            onNodeDragStop,
            onBeforeDelete,
          })}
          onInit={onInit}
          onNodeClick={onNodeClick}
          onSelectionChange={onSelectionChange}
          onPaneClick={onPaneClick}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          nodesFocusable={false}
          elementsSelectable
          edgesReconnectable={!readOnly}
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
