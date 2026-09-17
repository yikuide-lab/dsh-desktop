import { useMemo, useState } from 'react'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import type { Workflow, WorkflowStep } from './workflow-store.js'
import { workflowViewToYaml } from './desktop-workflow-api.js'
import { parseWorkflowYaml } from './workflow-template-clone.js'
import { WorkflowCanvas } from './WorkflowCanvas.js'

export type WorkflowPreviewMode = 'visual' | 'yaml'

interface WorkflowPreviewProps {
  /** Prefer structured steps when available (saved workflows). */
  workflow?: Workflow | null
  /** Raw YAML for templates or when the structured view is unavailable. */
  yaml?: string | null
  title?: string
  t: (key: WorkflowLocaleKey) => string
  /** Default tab; visual when the graph can be shown. */
  defaultMode?: WorkflowPreviewMode
  /** Stretch the visual canvas to fill the parent (AI design workspace). */
  fillHeight?: boolean
}

function resolvePreview(input: {
  workflow?: Workflow | null
  yaml?: string | null
}): {
  steps: WorkflowStep[]
  yamlText: string
  parseError: string | null
} {
  if (input.workflow) {
    return {
      steps: input.workflow.steps ?? [],
      yamlText: input.yaml?.trim() ? input.yaml : workflowViewToYaml(input.workflow),
      parseError: null,
    }
  }
  const yamlText = input.yaml ?? ''
  if (!yamlText.trim()) {
    return { steps: [], yamlText, parseError: null }
  }
  try {
    const view = parseWorkflowYaml(yamlText)
    return { steps: view.steps ?? [], yamlText, parseError: null }
  } catch (err) {
    return {
      steps: [],
      yamlText,
      parseError: err instanceof Error ? err.message : 'parse failed',
    }
  }
}

/**
 * Read-only workflow/template preview: visual canvas (like the designer)
 * plus the YAML source, switched by tabs.
 */
export function WorkflowPreview({
  workflow,
  yaml,
  title,
  t,
  defaultMode = 'visual',
  fillHeight = false,
}: WorkflowPreviewProps) {
  const resolved = useMemo(() => {
    const input: { workflow?: Workflow | null; yaml?: string | null } = {}
    if (workflow !== undefined) input.workflow = workflow
    if (yaml !== undefined) input.yaml = yaml
    return resolvePreview(input)
  }, [workflow, yaml])
  const canVisual = resolved.parseError === null && resolved.steps.length > 0
  const [mode, setMode] = useState<WorkflowPreviewMode>(
    defaultMode === 'visual' && canVisual ? 'visual' : 'yaml',
  )

  const activeMode: WorkflowPreviewMode = mode === 'visual' && !canVisual ? 'yaml' : mode

  return (
    <div className={`workflow-preview${fillHeight ? ' is-fill' : ''}`}>
      <div className="workflow-preview-header">
        <h4>{title ? `${t('editorPreview')}: ${title}` : t('editorPreview')}</h4>
        <div className="workflow-preview-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeMode === 'visual'}
            className={`workflow-preview-tab${activeMode === 'visual' ? ' active' : ''}`}
            disabled={!canVisual}
            onClick={() => setMode('visual')}
          >
            {t('previewVisual')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeMode === 'yaml'}
            className={`workflow-preview-tab${activeMode === 'yaml' ? ' active' : ''}`}
            onClick={() => setMode('yaml')}
          >
            {t('previewYaml')}
          </button>
        </div>
      </div>

      {resolved.parseError && (
        <div className="workflow-error">{t('previewParseFailed')}: {resolved.parseError}</div>
      )}

      {activeMode === 'visual' ? (
        canVisual ? (
          <div className="workflow-preview-canvas">
            <WorkflowCanvas steps={resolved.steps} t={t} readOnly />
          </div>
        ) : (
          <p className="workflow-preview-empty">{t('previewEmpty')}</p>
        )
      ) : (
        <pre className="workflow-template-yaml">{resolved.yamlText || t('previewEmpty')}</pre>
      )}
    </div>
  )
}
