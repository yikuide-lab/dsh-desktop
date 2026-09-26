import type { WorkflowLocaleKey } from './locales-workflow.js'
import type { WorkflowStepType } from './desktop-workflow-api.js'

const PALETTE_TYPES: WorkflowStepType[] = [
  'script',
  'task',
  'llm',
  'approval',
  'collab_peer',
  'sub_workflow',
]

interface WorkflowNodePaletteProps {
  t: (key: WorkflowLocaleKey) => string
  onAdd: (type: WorkflowStepType) => void
}

function typeLabel(type: WorkflowStepType, t: (key: WorkflowLocaleKey) => string): string {
  switch (type) {
    case 'script': return t('stepScript')
    case 'task': return t('stepTask')
    case 'llm': return t('stepLlm')
    case 'approval': return t('stepApproval')
    case 'collab_peer': return t('stepCollabPeer')
    case 'sub_workflow': return t('stepSubWorkflow')
  }
}

/** Left-side palette for adding step nodes to the canvas. */
export function WorkflowNodePalette({ t, onAdd }: WorkflowNodePaletteProps) {
  return (
    <aside className="workflow-canvas-palette">
      <h4>{t('canvasPalette')}</h4>
      <p className="workflow-canvas-palette-hint">{t('canvasPaletteHint')}</p>
      <div className="workflow-canvas-palette-list">
        {PALETTE_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className={`workflow-canvas-palette-item type-${type}`}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData('application/workflow-node-type', type)
              event.dataTransfer.effectAllowed = 'move'
            }}
            onClick={() => onAdd(type)}
          >
            <span className="workflow-canvas-palette-type">{type}</span>
            <span>{typeLabel(type, t)}</span>
          </button>
        ))}
      </div>
    </aside>
  )
}
