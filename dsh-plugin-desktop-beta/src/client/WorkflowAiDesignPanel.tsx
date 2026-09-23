import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import type {
  DesktopWorkflowApi,
  ValidationView,
  WorkflowModelCatalogView,
} from './desktop-workflow-api.js'
import { WorkflowPreview } from './WorkflowPreview.js'
import {
  canDesignRedo,
  canDesignUndo,
  createDesignHistory,
  currentDesignRevision,
  ensureDesignBaseline,
  jumpDesignRevision,
  pushDesignRevision,
  redoDesignRevision,
  undoDesignRevision,
  type WorkflowDesignHistoryState,
} from './workflow-design-history.js'

const DESIGN_MAX_TOKEN_OPTIONS = [4_096, 8_192, 16_384, 32_768] as const
const DEFAULT_DESIGN_MAX_TOKENS = 16_384

/** Stop React Flow / overlay handlers from swallowing prompt keystrokes. */
function stopEditorChromeEvents(
  event: KeyboardEvent<HTMLElement> | PointerEvent<HTMLElement>,
): void {
  event.stopPropagation()
}

interface WorkflowAiDesignPanelProps {
  api: DesktopWorkflowApi
  /** Current editor draft YAML (used when modifying). */
  getCurrentYaml: () => Promise<string>
  /** Restore a YAML snapshot into the editor (does not save). */
  onApply: (yaml: string) => void
  /**
   * Undo/redo target. Defaults to `onApply`. Split this out when `onApply`
   * commits (e.g. saves a workflow) so history navigation stays non-destructive.
   */
  onRestore?: (yaml: string) => void
  /** Overrides the apply button label (e.g. "Apply to workflow"). */
  applyLabel?: string
  /** Overrides the confirm text shown when applying an invalid design. */
  applyInvalidConfirmLabel?: string
  /** Pre-fills the prompt (e.g. a generated diagnosis prompt). */
  initialPrompt?: string
  /** Kick off generation as soon as the panel opens (one-shot per open). */
  autoGenerate?: boolean
  /**
   * Reports the current generated draft (null when there is none) so a host
   * dialog can drive its own pinned action bar without scrolling to reach the
   * workspace footer.
   */
  onDraftChange?: (yaml: string | null) => void
  t: (key: WorkflowLocaleKey) => string
  /** Controlled open state (toolbar toggle lives in the editor). */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** True while a generated draft occupies the main editor area. */
  onPreviewActiveChange?: (active: boolean) => void
}

function summarizePrompt(prompt: string, fallback: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, ' ')
  if (!trimmed) return fallback
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed
}

function catalogRoutes(catalog: WorkflowModelCatalogView | null): string[] {
  if (!catalog) return []
  const routes: string[] = []
  for (const group of catalog.providers) {
    for (const model of group.models) {
      if (!group.id || !model.id) continue
      routes.push(`${group.id}/${model.id}`)
    }
  }
  return routes
}

/**
 * Prompt → AI draft YAML → preview → user applies into the editor.
 * Chrome stays compact; pending preview fills the main workspace so Apply stays visible.
 */
export function WorkflowAiDesignPanel({
  api,
  getCurrentYaml,
  onApply,
  onRestore,
  applyLabel,
  applyInvalidConfirmLabel,
  initialPrompt,
  autoGenerate = false,
  onDraftChange,
  t,
  open,
  onOpenChange,
  onPreviewActiveChange,
}: WorkflowAiDesignPanelProps) {
  const [prompt, setPrompt] = useState(initialPrompt ?? '')
  const [useCurrent, setUseCurrent] = useState(true)
  const [includeModelCatalog, setIncludeModelCatalog] = useState(true)
  const [designModel, setDesignModel] = useState('')
  const [maxTokens, setMaxTokens] = useState<number>(DEFAULT_DESIGN_MAX_TOKENS)
  const [catalog, setCatalog] = useState<WorkflowModelCatalogView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingYaml, setPendingYaml] = useState<string | null>(null)
  const [validation, setValidation] = useState<ValidationView | null>(null)
  const [mode, setMode] = useState<'create' | 'modify' | null>(null)
  const [history, setHistory] = useState<WorkflowDesignHistoryState>(() => createDesignHistory())
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const previewActive = open && pendingYaml !== null
  const modelRoutes = catalogRoutes(catalog)

  useEffect(() => {
    onPreviewActiveChange?.(previewActive)
  }, [previewActive, onPreviewActiveChange])

  useEffect(() => {
    if (!open) {
      // Closing the panel clears an unapplied preview so the editor returns.
      setPendingYaml(null)
      setValidation(null)
      setError(null)
      return
    }
    let cancelled = false
    void api.listModelCatalog().then((next) => {
      if (cancelled) return
      setCatalog(next)
      setDesignModel((current) => {
        if (current) return current
        if (next.defaultRoute && next.defaultModel) {
          return `${next.defaultRoute}/${next.defaultModel}`
        }
        return current
      })
    }).catch(() => {
      if (!cancelled) setCatalog(null)
    })
    return () => {
      cancelled = true
    }
  }, [open, api])

  useEffect(() => {
    if (!open || busy || pendingYaml) return
    const frame = requestAnimationFrame(() => {
      promptRef.current?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, busy, pendingYaml])

  const restoreYaml = (yaml: string): void => {
    (onRestore ?? onApply)(yaml)
    setError(null)
  }

  const handleGenerate = async () => {
    const trimmed = prompt.trim()
    if (!trimmed) {
      setError(t('aiDesignPromptRequired'))
      return
    }
    setBusy(true)
    setError(null)
    setPendingYaml(null)
    setValidation(null)
    try {
      const currentYaml = useCurrent ? await getCurrentYaml() : ''
      const designMode = useCurrent && currentYaml.trim() ? 'modify' : 'create'
      const result = await api.designWorkflow({
        prompt: trimmed,
        mode: designMode,
        includeModelCatalog,
        ...(designModel.trim() ? { designModel: designModel.trim() } : {}),
        maxTokens,
        ...(designMode === 'modify' ? { yaml: currentYaml } : {}),
      })
      setMode(result.mode)
      setPendingYaml(result.yaml)
      setValidation(result.validation)
      if (!result.validation.ok) {
        setError(t('aiDesignInvalid'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setBusy(false)
    }
  }

  const handleApply = async () => {
    if (!pendingYaml) return
    if (validation && !validation.ok) {
      if (!window.confirm(applyInvalidConfirmLabel ?? t('aiDesignApplyInvalidConfirm'))) return
    }
    try {
      const baselineYaml = await getCurrentYaml()
      const withBase = ensureDesignBaseline(history, baselineYaml, t('aiDesignHistoryBaseline'))
      const trimmedPrompt = prompt.trim()
      const next = pushDesignRevision(withBase, {
        yaml: pendingYaml,
        label: summarizePrompt(prompt, t('aiDesignHistoryApplied')),
        ...(trimmedPrompt ? { prompt: trimmedPrompt } : {}),
      })
      setHistory(next)
      onApply(pendingYaml)
      setPendingYaml(null)
      setValidation(null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    }
  }

  const handleDiscard = () => {
    setPendingYaml(null)
    setValidation(null)
    setError(null)
  }

  // One-shot auto generation: "AI diagnose" should diagnose on open rather than
  // leaving the user staring at an empty result area behind a manual button.
  const generateRef = useRef(handleGenerate)
  generateRef.current = handleGenerate
  const autoGenerateRef = useRef(false)
  useEffect(() => {
    if (!open) {
      autoGenerateRef.current = false
      return
    }
    if (!autoGenerate || autoGenerateRef.current) return
    autoGenerateRef.current = true
    void generateRef.current()
  }, [open, autoGenerate])

  const draftChangeRef = useRef(onDraftChange)
  draftChangeRef.current = onDraftChange
  useEffect(() => {
    draftChangeRef.current?.(pendingYaml)
  }, [pendingYaml])

  const handleUndo = () => {
    if (!canDesignUndo(history)) return
    const next = undoDesignRevision(history)
    const rev = currentDesignRevision(next)
    setHistory(next)
    if (rev) restoreYaml(rev.yaml)
  }

  const handleRedo = () => {
    if (!canDesignRedo(history)) return
    const next = redoDesignRevision(history)
    const rev = currentDesignRevision(next)
    setHistory(next)
    if (rev) restoreYaml(rev.yaml)
  }

  const handleJump = (index: number) => {
    const next = jumpDesignRevision(history, index)
    if (next.index === history.index && next.revisions === history.revisions) return
    const rev = currentDesignRevision(next)
    setHistory(next)
    if (rev) restoreYaml(rev.yaml)
  }

  if (!open) return null

  return (
    <div className={`workflow-ai-design is-open${previewActive ? ' has-preview' : ''}`}>
      <div
        className="workflow-ai-design-chrome"
        onPointerDown={stopEditorChromeEvents}
        onKeyDown={stopEditorChromeEvents}
      >
        <div className="workflow-ai-design-header">
          <div>
            <h3>{t('aiDesignTitle')}</h3>
            <p>{t('aiDesignHint')}</p>
          </div>
          <button
            type="button"
            className="workflow-btn small"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t('close')}
          </button>
        </div>

        <label className="workflow-form-group">
          <span>{t('aiDesignPrompt')}</span>
          <textarea
            ref={promptRef}
            rows={3}
            value={prompt}
            disabled={busy}
            onChange={(event) => setPrompt(event.target.value)}
            onPointerDown={stopEditorChromeEvents}
            onKeyDown={stopEditorChromeEvents}
            placeholder={t('aiDesignPromptPlaceholder')}
          />
        </label>

        <div className="workflow-ai-design-options">
          <label className="workflow-ai-design-check">
            <input
              type="checkbox"
              checked={useCurrent}
              disabled={busy}
              onChange={(event) => setUseCurrent(event.target.checked)}
            />
            <span>{t('aiDesignUseCurrent')}</span>
          </label>

          <label className="workflow-ai-design-check">
            <input
              type="checkbox"
              checked={includeModelCatalog}
              disabled={busy}
              onChange={(event) => setIncludeModelCatalog(event.target.checked)}
            />
            <span>{t('aiDesignIncludeModels')}</span>
          </label>
        </div>
        <p className="workflow-ai-design-check-hint">{t('aiDesignIncludeModelsHint')}</p>

        <div className="workflow-ai-design-model-row">
          <label className="workflow-form-group">
            <span>{t('aiDesignModel')}</span>
            <select
              value={designModel}
              disabled={busy}
              onChange={(event) => setDesignModel(event.target.value)}
            >
              <option value="">{t('aiDesignModelAuto')}</option>
              {modelRoutes.map((route) => (
                <option key={route} value={route}>{route}</option>
              ))}
            </select>
          </label>
          <label className="workflow-form-group">
            <span>{t('aiDesignMaxTokens')}</span>
            <select
              value={String(maxTokens)}
              disabled={busy}
              onChange={(event) => setMaxTokens(Number(event.target.value) || DEFAULT_DESIGN_MAX_TOKENS)}
            >
              {DESIGN_MAX_TOKEN_OPTIONS.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="workflow-ai-design-check-hint">{t('aiDesignModelHint')}</p>

        <div className="workflow-ai-design-actions">
          <button
            type="button"
            className={`workflow-btn${pendingYaml ? '' : ' primary'}`}
            disabled={busy}
            onClick={() => void handleGenerate()}
          >
            {busy ? t('aiDesignGenerating') : t('aiDesignGenerate')}
          </button>
          <button
            type="button"
            className={`workflow-btn${pendingYaml ? ' primary' : ''}`}
            disabled={busy || !pendingYaml}
            onClick={() => void handleApply()}
            title={applyLabel ?? t('aiDesignApply')}
          >
            {applyLabel ?? t('aiDesignApply')}
          </button>
          <button
            type="button"
            className="workflow-btn"
            disabled={busy || !canDesignUndo(history)}
            onClick={handleUndo}
            title={t('aiDesignUndo')}
          >
            {t('aiDesignUndo')}
          </button>
          <button
            type="button"
            className="workflow-btn"
            disabled={busy || !canDesignRedo(history)}
            onClick={handleRedo}
            title={t('aiDesignRedo')}
          >
            {t('aiDesignRedo')}
          </button>
        </div>

        {history.revisions.length > 0 && (
          <div className="workflow-ai-design-history">
            <div className="workflow-ai-design-history-header">
              <strong>{t('aiDesignHistory')}</strong>
              <span>
                {history.index + 1}/{history.revisions.length}
              </span>
            </div>
            <ul className="workflow-ai-design-history-list">
              {history.revisions.map((revision, index) => (
                <li key={revision.id}>
                  <button
                    type="button"
                    className={`workflow-ai-design-history-item${index === history.index ? ' active' : ''}`}
                    disabled={busy}
                    onClick={() => handleJump(index)}
                  >
                    <span className="workflow-ai-design-history-label">{revision.label}</span>
                    <span className="workflow-ai-design-history-time">
                      {new Date(revision.createdAt).toLocaleTimeString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <div className="workflow-error">{error}</div>}
      </div>

      {pendingYaml && (
        <div className="workflow-ai-design-workspace">
          <div className="workflow-ai-design-workspace-header">
            <strong>
              {mode === 'modify' ? t('aiDesignPendingModify') : t('aiDesignPendingCreate')}
            </strong>
            <span>{t('aiDesignConfirmHint')}</span>
          </div>
          {validation && (
            <div className={`workflow-validation ${validation.ok ? 'valid' : 'invalid'}`}>
              {validation.ok ? t('editorValid') : t('editorInvalid')}
              {!validation.ok && (
                <ul>
                  {validation.errors.map((entry, index) => (
                    <li key={`${entry.path}-${index}`}>
                      {entry.path}: {entry.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="workflow-ai-design-workspace-body">
            <WorkflowPreview
              yaml={pendingYaml}
              title={t('aiDesignPreview')}
              t={t}
              defaultMode="visual"
              fillHeight
            />
          </div>
          <div className="workflow-ai-design-workspace-foot">
            <button
              type="button"
              className="workflow-btn primary"
              onClick={() => void handleApply()}
            >
              {applyLabel ?? t('aiDesignApply')}
            </button>
            <button type="button" className="workflow-btn" onClick={handleDiscard}>
              {t('aiDesignDiscard')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
