import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import type { Workflow, WorkflowStep } from './workflow-store.js'
import type { DesktopWorkflowApi } from './desktop-workflow-api.js'
import { workflowViewToYaml } from './desktop-workflow-api.js'
import { parseWorkflowYaml } from './workflow-template-clone.js'
import { WorkflowCanvas } from './WorkflowCanvas.js'
import { WorkflowAiDesignPanel } from './WorkflowAiDesignPanel.js'
import { useWorkflowLeaveGuard, useWorkflowRequestLeave } from './workflow-leave-guard.js'

interface WorkflowEditorProps {
  workflow: Workflow | null
  initialYaml?: string | null
  /** Prefer visual editor when opening a template copy (YAML remains available). */
  preferVisual?: boolean
  api: DesktopWorkflowApi
  onSave: () => void
  onCancel: () => void
  t: (key: WorkflowLocaleKey) => string
}

function applyViewToForm(
  view: Workflow,
  setters: {
    setName: (v: string) => void
    setTitle: (v: string) => void
    setDescription: (v: string) => void
    setSteps: (v: WorkflowStep[]) => void
  },
): void {
  setters.setName(view.name)
  setters.setTitle(view.title)
  setters.setDescription(view.description || '')
  setters.setSteps(view.steps || [])
}

export function WorkflowEditor({
  workflow,
  initialYaml,
  preferVisual = false,
  api,
  onSave,
  onCancel,
  t,
}: WorkflowEditorProps) {
  const [name, setName] = useState(workflow?.name || '')
  const [title, setTitle] = useState(workflow?.title || '')
  const [description, setDescription] = useState(workflow?.description || '')
  const [steps, setSteps] = useState<WorkflowStep[]>(workflow?.steps || [])
  const [yamlMode, setYamlMode] = useState(Boolean(initialYaml) && !preferVisual)
  const [yamlContent, setYamlContent] = useState(initialYaml || '')
  const [validationResult, setValidationResult] = useState<{ valid: boolean; errors: string[] } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiPreviewActive, setAiPreviewActive] = useState(false)
  const [baselineYaml, setBaselineYaml] = useState('')
  const requestLeave = useWorkflowRequestLeave()
  const baselineReady = useRef(false)

  useEffect(() => {
    const setters = { setName, setTitle, setDescription, setSteps }
    if (initialYaml) {
      setYamlContent(initialYaml)
      try {
        applyViewToForm(parseWorkflowYaml(initialYaml), setters)
        setYamlMode(!preferVisual)
        setBaselineYaml(initialYaml)
        baselineReady.current = true
        setError(null)
      } catch (err) {
        setYamlMode(true)
        setBaselineYaml(initialYaml)
        baselineReady.current = true
        setError(err instanceof Error ? err.message : t('error'))
      }
      return
    }
    if (workflow) {
      applyViewToForm(workflow, setters)
      const yaml = workflowViewToYaml(workflow)
      setYamlContent(yaml)
      setBaselineYaml(yaml)
      baselineReady.current = true
      setYamlMode(false)
      return
    }
    setName('')
    setTitle('')
    setDescription('')
    setSteps([])
    setYamlContent('')
    setBaselineYaml('')
    baselineReady.current = true
    setYamlMode(false)
  }, [workflow, initialYaml, preferVisual, t])

  const currentView = (): Workflow => ({
    name,
    title,
    description,
    steps,
  })

  const draftYaml = (): string => (
    yamlMode ? yamlContent : workflowViewToYaml(currentView())
  )

  const isDirty = useCallback((): boolean => {
    if (!baselineReady.current) return false
    if (aiPreviewActive) return true
    return draftYaml() !== baselineYaml
  }, [aiPreviewActive, baselineYaml, description, name, steps, title, yamlContent, yamlMode])

  const syncYamlFromVisual = (): string => {
    const yaml = workflowViewToYaml(currentView())
    setYamlContent(yaml)
    return yaml
  }

  const syncYamlFromVisualCanonical = async (): Promise<string> => {
    const clientYaml = syncYamlFromVisual()
    try {
      const canonical = await api.canonicalizeYaml(clientYaml)
      setYamlContent(canonical)
      return canonical
    } catch {
      return clientYaml
    }
  }

  const syncVisualFromYaml = (yaml: string): boolean => {
    try {
      applyViewToForm(parseWorkflowYaml(yaml), { setName, setTitle, setDescription, setSteps })
      setError(null)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : t('editorYamlParseFailed'))
      return false
    }
  }

  const switchToVisual = (): void => {
    if (!yamlMode) return
    if (!syncVisualFromYaml(yamlContent)) {
      setYamlMode(true)
      return
    }
    setYamlMode(false)
  }

  const switchToYaml = (): void => {
    if (yamlMode) return
    void (async () => {
      await syncYamlFromVisualCanonical()
      setYamlMode(true)
    })()
  }

  const handleValidate = async () => {
    setError(null)
    try {
      const yaml = yamlMode ? yamlContent : await syncYamlFromVisualCanonical()
      const result = await api.validateWorkflow(yaml)
      const errors = result.errors.filter(e => e.severity === 'error').map(e => `${e.path}: ${e.message}`)
      const warnings = result.errors.filter(e => e.severity === 'warning').map(e => `${e.path}: ${e.message}`)
      setValidationResult({
        valid: result.ok,
        errors: [...errors, ...warnings.map((w) => `warning: ${w}`)],
      })
    } catch (err) {
      setValidationResult({
        valid: false,
        errors: [err instanceof Error ? err.message : t('error')],
      })
    }
  }

  const persistDraft = async (): Promise<boolean> => {
    setSaving(true)
    setError(null)
    try {
      if (yamlMode && !syncVisualFromYaml(yamlContent)) {
        return false
      }
      const yaml = yamlMode ? yamlContent : await syncYamlFromVisualCanonical()
      const result = await api.saveWorkflow(yaml)
      if (!result.validation.ok) {
        setValidationResult({
          valid: false,
          errors: result.validation.errors.map(e => `${e.path}: ${e.message}`),
        })
        return false
      }
      setBaselineYaml(yaml)
      setYamlContent(yaml)
      onSave()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    await persistDraft()
  }

  const handleCancel = async () => {
    const allowed = await requestLeave()
    if (allowed) onCancel()
  }

  useWorkflowLeaveGuard(true, isDirty, persistDraft)

  const applyAiDesign = (yaml: string): void => {
    setYamlContent(yaml)
    if (syncVisualFromYaml(yaml)) {
      setYamlMode(false)
      setValidationResult(null)
      setError(null)
    } else {
      setYamlMode(true)
    }
  }

  const getCurrentYamlForAi = async (): Promise<string> => {
    if (yamlMode) return yamlContent
    return syncYamlFromVisualCanonical()
  }

  const [awfSyncing, setAwfSyncing] = useState(false)
  const [awfNote, setAwfNote] = useState<string | null>(null)

  const handleSyncToAwf = async (): Promise<void> => {
    if (!name.trim()) {
      setAwfNote(t('awfSyncNameRequired'))
      return
    }
    setAwfSyncing(true)
    setAwfNote(null)
    try {
      const yaml = yamlMode ? yamlContent : await syncYamlFromVisualCanonical()
      const receipt = await api.syncWorkflowToAwf(name.trim(), 'private', yaml)
      if (receipt.ok) {
        setAwfNote(`${t('awfSyncOk')} #${receipt.workflow?.id ?? ''}`)
      } else if (receipt.stage === 'preflight') {
        const first = receipt.validation?.errors[0]?.msg
        setAwfNote(`${t('awfSyncPreflightFailed')}${receipt.validation?.conflict ? ` — ${receipt.validation.conflict}` : first ? ` — ${first}` : ''}`)
      } else {
        setAwfNote(`${t('awfSyncError')} [${receipt.errorKind ?? 'unknown'}] ${receipt.errorMessage ?? ''}`)
      }
    } catch (err) {
      setAwfNote(err instanceof Error ? err.message : t('error'))
    } finally {
      setAwfSyncing(false)
    }
  }

  return (
    <div className={`workflow-editor${aiOpen ? ' ai-open' : ''}${aiPreviewActive ? ' ai-preview' : ''}`}>
      <div className="workflow-editor-header">
        <h2>{workflow ? t('edit') : (initialYaml ? t('templateRedesignTitle') : t('create'))}</h2>
        <div className="workflow-editor-actions">
          <button className="workflow-btn" onClick={() => void handleCancel()} disabled={saving}>
            {t('cancel')}
          </button>
          <button
            className="workflow-btn"
            onClick={() => { void handleSyncToAwf() }}
            disabled={awfSyncing || saving || aiPreviewActive}
            title={t('awfSyncHint')}
          >
            {awfSyncing ? t('loading') : t('awfSyncButton')}
          </button>
          <button className="workflow-btn primary" onClick={() => void handleSave()} disabled={saving || aiPreviewActive}>
            {saving ? t('loading') : t('save')}
          </button>
        </div>
        {awfNote && <p className="workflow-error" role="status">{awfNote}</p>}
      </div>

      {error && <div className="workflow-error">{error}</div>}
      {initialYaml && (
        <p className="workflow-editor-hint">{t('templateRedesignHint')}</p>
      )}

      <div className="workflow-editor-toolbar">
        <button
          className={`workflow-btn ${!yamlMode ? 'active' : ''}`}
          onClick={switchToVisual}
          disabled={aiPreviewActive}
        >
          {t('editorVisual')}
        </button>
        <button
          className={`workflow-btn ${yamlMode ? 'active' : ''}`}
          onClick={switchToYaml}
          disabled={aiPreviewActive}
        >
          {t('editorYaml')}
        </button>
        <button className="workflow-btn" onClick={() => void handleValidate()} disabled={aiPreviewActive}>
          {t('editorValidate')}
        </button>
        <button
          type="button"
          className={`workflow-btn ${aiOpen ? 'active' : ''}`}
          onClick={() => setAiOpen((value) => !value)}
        >
          {t('aiDesign')}
        </button>
      </div>

      <WorkflowAiDesignPanel
        api={api}
        getCurrentYaml={getCurrentYamlForAi}
        onApply={applyAiDesign}
        t={t}
        open={aiOpen}
        onOpenChange={setAiOpen}
        onPreviewActiveChange={setAiPreviewActive}
      />

      {validationResult && !aiPreviewActive && (
        <div className={`workflow-validation ${validationResult.valid ? 'valid' : 'invalid'}`}>
          {validationResult.valid ? t('editorValid') : t('editorInvalid')}
          {!validationResult.valid && (
            <ul>
              {validationResult.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!aiPreviewActive && (yamlMode ? (
        <div className="workflow-yaml-editor">
          <textarea
            value={yamlContent}
            onChange={(e) => setYamlContent(e.target.value)}
            placeholder={t('yamlPlaceholder')}
            rows={20}
          />
        </div>
      ) : (
        <div className="workflow-visual-editor">
          <div className="workflow-form workflow-form-meta">
            <div className="workflow-form-group">
              <label>{t('name')}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-workflow"
              />
            </div>
            <div className="workflow-form-group">
              <label>{t('title_label')}</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="My Workflow"
              />
            </div>
            <div className="workflow-form-group">
              <label>{t('description')}</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('descriptionPlaceholder')}
              />
            </div>
          </div>
          <WorkflowCanvas
            steps={steps}
            onStepsChange={setSteps}
            api={api}
            t={t}
            onCycleRejected={() => setError(t('canvasCycleRejected'))}
          />
        </div>
      ))}
    </div>
  )
}
