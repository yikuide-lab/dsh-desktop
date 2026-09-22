import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import type {
  DesktopWorkflowApi,
  PendingGateView,
  RunStepView,
  WorkflowRunView,
  WorkflowStepView,
  WorkflowTranscriptEventView,
} from './desktop-workflow-api.js'
import { WorkflowCanvasNode, type WorkflowFlowNode } from './WorkflowNode.js'
import { WorkflowRunNarrative } from './WorkflowRunNarrative.js'
import type { CanvasGraphEdge, CanvasGraphNode, RunNodeStatus } from './workflow-canvas-layout.js'
import {
  activeEdgeIds,
  buildRunGraph,
  failedEdgeIds,
  focusNodeId,
  formatDuration,
  runStatusClass,
} from './workflow-run-graph.js'

const nodeTypes = { workflow: WorkflowCanvasNode }

const LEGEND: Array<{ status: RunNodeStatus; color: string; key: WorkflowLocaleKey }> = [
  { status: 'pending', color: '#9ca3af', key: 'pending' },
  { status: 'running', color: '#3b82f6', key: 'running' },
  { status: 'completed', color: '#22c55e', key: 'completed' },
  { status: 'failed', color: '#ef4444', key: 'failed' },
  { status: 'skipped', color: '#a855f7', key: 'skipped' },
  { status: 'waiting', color: '#f59e0b', key: 'runStatusWaiting' },
  { status: 'aborted', color: '#f59e0b', key: 'aborted' },
]

const STATUS_COLORS: Record<RunNodeStatus, string> = {
  pending: '#9ca3af',
  running: '#3b82f6',
  completed: '#22c55e',
  failed: '#ef4444',
  skipped: '#a855f7',
  waiting: '#f59e0b',
  aborted: '#f59e0b',
}

interface WorkflowRunGraphProps {
  api: DesktopWorkflowApi
  t: (key: WorkflowLocaleKey) => string
  run: WorkflowRunView
  gates: PendingGateView[]
  transcript: WorkflowTranscriptEventView[]
  onResolveGate: (gate: PendingGateView, decision: string) => void
  resolvingGate: string | null
}

interface WorkflowRunGraphInnerProps extends WorkflowRunGraphProps {
  selectedStepId: string | null
  onSelectStep: (stepId: string | null) => void
}

function WorkflowRunGraphInner({
  api,
  t,
  run,
  gates,
  transcript,
  onResolveGate,
  resolvingGate,
  selectedStepId,
  onSelectStep,
}: WorkflowRunGraphInnerProps) {
  const [workflowSteps, setWorkflowSteps] = useState<readonly WorkflowStepView[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const flowRef = useRef<ReactFlowInstance | null>(null)

  // Load the workflow definition once per workflow name (positions + deps).
  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    void (async () => {
      try {
        const workflow = await api.getWorkflow(run.workflowName)
        if (cancelled) return
        if (!workflow) {
          setWorkflowSteps([])
          setLoadError(t('runGraphWorkflowMissing'))
          return
        }
        setWorkflowSteps(workflow.steps)
      } catch (err) {
        if (!cancelled) {
          setWorkflowSteps([])
          setLoadError(err instanceof Error ? err.message : t('error'))
        }
      }
    })()
    return () => { cancelled = true }
  }, [api, run.workflowName, t])

  const pendingGateStepIds = useMemo(
    () => new Set(gates.map((gate) => gate.stepId)),
    [gates],
  )

  const graph = useMemo(() => {
    if (!workflowSteps) return null
    return buildRunGraph(workflowSteps, run.steps ?? [], { pendingGateStepIds })
  }, [workflowSteps, run.steps, pendingGateStepIds])

  const activeIds = useMemo(
    () => (graph ? new Set(activeEdgeIds(graph.nodes, graph.edges)) : new Set<string>()),
    [graph],
  )
  const failedIds = useMemo(
    () => (graph ? new Set(failedEdgeIds(graph.nodes, graph.edges)) : new Set<string>()),
    [graph],
  )

  const flowNodes: Node[] = useMemo(() => {
    if (!graph) return []
    return graph.nodes.map((node: CanvasGraphNode) => ({
      id: node.id,
      position: node.position,
      type: 'workflow',
      data: node.data,
      selected: node.id === selectedStepId,
      className: node.id === selectedStepId ? 'linked' : '',
      draggable: false,
      connectable: false,
    })) as WorkflowFlowNode[]
  }, [graph, selectedStepId])

  const flowEdges: Edge[] = useMemo(() => {
    if (!graph) return []
    return graph.edges.map((edge: CanvasGraphEdge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      animated: activeIds.has(edge.id),
      className: activeIds.has(edge.id)
        ? 'workflow-flow-edge-active'
        : failedIds.has(edge.id)
          ? 'workflow-flow-edge-failed'
          : '',
    }))
  }, [graph, activeIds, failedIds])

  // Keep the currently-running node in view as the run progresses.
  useEffect(() => {
    if (!graph) return
    const auto = focusNodeId(graph.nodes)
    if (auto && !selectedStepId) onSelectStep(auto)
  }, [graph, selectedStepId, onSelectStep])

  // Narrative → graph: center the linked node so cross-highlight is visible.
  const centerNode = useCallback((nodeId: string | null) => {
    if (!nodeId) return
    const instance = flowRef.current
    if (!instance) return
    const node = graph?.nodes.find((entry) => entry.id === nodeId)
    if (!node) return
    const zoom = instance.getZoom()
    instance.setCenter(node.position.x + 90, node.position.y + 36, {
      zoom: Math.max(0.8, zoom),
      duration: 320,
    })
  }, [graph])

  const handleNodeClick = useCallback((_event: unknown, node: Node) => {
    onSelectStep(node.id === selectedStepId ? null : node.id)
  }, [onSelectStep, selectedStepId])

  const handleSelectFromNarrative = useCallback((stepId: string | null) => {
    onSelectStep(stepId)
    centerNode(stepId)
  }, [onSelectStep, centerNode])

  const selectedStep: RunStepView | undefined = useMemo(
    () => run.steps?.find((step) => step.id === selectedStepId),
    [run.steps, selectedStepId],
  )
  const selectedStatus: RunNodeStatus = selectedStep
    ? runStatusClass(selectedStep.status, { hasPendingGate: pendingGateStepIds.has(selectedStep.id) })
    : 'pending'
  const selectedGate = gates.find((gate) => gate.stepId === selectedStepId) ?? null

  const stepTypeById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const step of workflowSteps ?? []) map[step.id] = step.type
    return map
  }, [workflowSteps])

  const narrativeSummary = useMemo(() => {
    if (!selectedStep) return null
    return (
      <div className="workflow-run-narrative-summary">
        <div className="workflow-run-graph-detail-header">
          <span className="workflow-run-graph-detail-id">{selectedStep.id}</span>
          <span
            className="workflow-run-graph-detail-badge"
            style={{ backgroundColor: STATUS_COLORS[selectedStatus] }}
          >
            {t(selectedStatus === 'waiting' ? 'runStatusWaiting' : (selectedStep.status as WorkflowLocaleKey))}
          </span>
        </div>
        <div className="workflow-run-graph-detail-row">
          <label>{t('runNodeSummary')}</label>
          <span>{formatDuration(selectedStep.durationMs) ?? '-'}</span>
        </div>
        <div className="workflow-run-graph-detail-row">
          <label>{t('runStepAttempts')}</label>
          <span>{selectedStep.attempt ?? (selectedStep.dispatches?.length || '-')}</span>
        </div>
        {selectedGate && (
          <div className="workflow-gate-card" style={{ marginTop: 6 }}>
            <p className="workflow-gate-question">{selectedGate.question}</p>
            <div className="workflow-gate-actions">
              {selectedGate.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={resolvingGate !== null}
                  className={`workflow-btn small ${
                    (selectedGate.pass?.includes(option)
                      || (!selectedGate.pass && (option === 'approved' || option === selectedGate.options[0])))
                      ? 'primary' : ''
                  }`}
                  onClick={() => onResolveGate(selectedGate, option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }, [selectedStep, selectedStatus, selectedGate, resolvingGate, onResolveGate, t])

  if (loadError && !workflowSteps) {
    return (
      <div className="workflow-run-graph">
        <div className="workflow-error" role="alert">{loadError}</div>
        <StepFallbackList t={t} run={run} />
      </div>
    )
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="workflow-run-graph">
        <StepFallbackList t={t} run={run} />
      </div>
    )
  }

  return (
    <div className="workflow-run-graph">
      <div className="workflow-run-graph-toolbar">
        <div className="workflow-run-graph-legend" aria-label={t('runGraphLegend')}>
          {LEGEND.map((item) => (
            <span key={item.status} className="workflow-run-graph-legend-item">
              <span
                className="workflow-run-graph-legend-dot"
                style={{ backgroundColor: item.color }}
                aria-hidden="true"
              />
              {t(item.key)}
            </span>
          ))}
        </div>
      </div>

      <div className="workflow-run-graph-body">
        <div className="workflow-canvas-stage workflow-run-graph-stage">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes as never}
            onNodeClick={handleNodeClick}
            onPaneClick={() => onSelectStep(null)}
            onInit={(instance) => { flowRef.current = instance }}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            elementsSelectable
            edgesReconnectable={false}
            deleteKeyCode={null}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

        <WorkflowRunNarrative
          t={t}
          steps={run.steps ?? []}
          transcript={transcript}
          stepTypeById={stepTypeById}
          selectedStepId={selectedStepId}
          onSelectStep={handleSelectFromNarrative}
          summary={narrativeSummary}
        />
      </div>
    </div>
  )
}

/** Plain step list used when the workflow definition is unavailable. */
function StepFallbackList({ t, run }: { t: (key: WorkflowLocaleKey) => string; run: WorkflowRunView }) {
  return (
    <div className="workflow-run-steps">
      {run.steps?.map((step) => (
        <div key={step.id} className="workflow-run-step">
          <div className="workflow-run-step-header">
            <span className="workflow-run-step-id">{step.id}</span>
            <span>{step.status}</span>
          </div>
          {step.output && <pre className="workflow-run-step-output">{step.output}</pre>}
          {step.error && <div className="workflow-run-step-error">{step.error}</div>}
        </div>
      ))}
      <p className="workflow-canvas-inspector-empty">{t('runGraphFallbackHint')}</p>
    </div>
  )
}

/**
 * Live run DAG: read-only React Flow graph with per-node status animation,
 * active-edge flow, and a side detail panel.
 */
export function WorkflowRunGraph(props: WorkflowRunGraphProps) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)

  // Reset selection when switching runs.
  useEffect(() => {
    setSelectedStepId(null)
  }, [props.run.id])

  return (
    <ReactFlowProvider>
      <WorkflowRunGraphInner
        {...props}
        selectedStepId={selectedStepId}
        onSelectStep={setSelectedStepId}
      />
    </ReactFlowProvider>
  )
}

// Keep NodeProps referenced so the custom node type stays typed.
export type RunGraphNodeProps = NodeProps & { data: WorkflowFlowNode['data'] }
