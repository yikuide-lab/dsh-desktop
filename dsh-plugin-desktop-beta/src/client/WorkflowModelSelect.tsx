import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ModelSelection, ModelProviderGroup } from '@deepseek-ai/dsh-api-session-controller/types'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import type { WorkflowView } from './desktop-workflow-api.js'

/** Provider id carrying workflow-backed routes (the OpenAI surface keys `model` to the workflow name). */
export const WORKFLOW_PROVIDER_ID = 'workflow'

/**
 * Structural view of upstream `ModelDirectoryState`, kept local so this seat
 * adds no package edge to `@deepseek-ai/dsh-client-ui-model-selection`.
 */
export interface SeatDirectoryState {
  current: ModelSelection | null
  groups: readonly ModelProviderGroup[]
  status: string
  error: string | null
}

/** uSES-compatible store of the per-session directory. */
export interface SeatDirectoryStore {
  subscribe(fn: () => void): () => void
  getSnapshot(): SeatDirectoryState
}

/**
 * Business face injected into the composer model seat. The first four members
 * mirror upstream `ModelSelectInjected` so the models tab keeps stock behaviour;
 * `listWorkflows` supplies the workflow tab's rows.
 */
export interface WorkflowModelSeatInjected {
  /** Whether this session supports Agent-bound model inspection and selection. */
  available: boolean
  /** The session's shared directory store (same instance the /model popup reads). */
  directory: SeatDirectoryStore
  /** Ensure the shared advisory catalog is loaded (errors land on the store). */
  load: () => void
  /**
   * Select a complete provider/model/effort selection.
   * @param selection - model selection and optional adapter-owned effort.
   * @returns whether the host accepted the selection.
   */
  select: (selection: ModelSelection) => Promise<boolean>
  /** Workflow rows for the workflow tab. */
  listWorkflows: () => Promise<WorkflowView[]>
}

type SeatProps = WorkflowModelSeatInjected & {
  locked: boolean
  /** Bound translator for the `dsh-plugin-desktop/workflow` namespace. */
  t: (key: WorkflowLocaleKey) => string
}

type Tab = 'models' | 'workflows'

function rowId(provider: string, model: string): string {
  return `${provider}/${model}`
}

function newId(): string {
  return `wf-seat-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * The composer's model seat, tabbed: 常规模型 / 工作流.
 *
 * Occupies `conversation.input.model` at a lower priority than upstream so this
 * component shadows the stock ModelSelect (the slot spec renders the lowest
 * priority). The models tab is the stock provider-grouped directory; the
 * workflow tab lists saved workflows as one special model type whose routes the
 * workflow engine serves through its OpenAI-compatible surface (`model` is the
 * workflow name).
 */
export function WorkflowModelSelect({
  locked,
  available,
  directory,
  load,
  select,
  listWorkflows,
  t,
}: SeatProps) {
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('models')
  const [workflows, setWorkflows] = useState<WorkflowView[] | null>(null)
  const [workflowsError, setWorkflowsError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const [id] = useState(newId)

  const groups = state.groups
  const current = state.current

  // Model rows mirror upstream's flattening: one row per provider/model.
  const modelRows = useMemo(() => groups.flatMap(group =>
    group.models.map(model => ({
      key: rowId(group.id, model.id),
      group,
      model,
      active: current?.provider === group.id && current.model === model.id,
    })),
  ), [groups, current])

  const workflowRows = useMemo(() => (workflows ?? []).map(workflow => ({
    key: rowId(WORKFLOW_PROVIDER_ID, workflow.name),
    workflow,
    active: current?.provider === WORKFLOW_PROVIDER_ID && current.model === workflow.name,
  })), [workflows, current])

  // Caption: a workflow route reads as a special model type, never as a bare name.
  const caption = useMemo(() => {
    if (current === null) return t('seatModelAuto')
    if (current.provider === WORKFLOW_PROVIDER_ID) return `${t('seatWorkflowBadge')}: ${current.model}`
    const group = groups.find(entry => entry.id === current.provider)
    const model = group?.models.find(entry => entry.id === current.model)
    return model?.name ?? `${current.provider}/${current.model}`
  }, [current, groups, t])

  useEffect(() => {
    if (!open) return
    load()
  }, [open, load])

  useEffect(() => {
    if (!open || workflows !== null || workflowsError !== null) return
    let cancelled = false
    void listWorkflows().then(rows => {
      if (!cancelled) setWorkflows(rows)
    }, (error: unknown) => {
      if (!cancelled) setWorkflowsError(error instanceof Error ? error.message : String(error))
    })
    return () => { cancelled = true }
  }, [open, listWorkflows, workflows, workflowsError])

  // Close on outside click / Escape, and pin the menu under the trigger.
  useEffect(() => {
    if (!open) return
    const measure = () => {
      const trigger = triggerRef.current
      if (trigger === null) return
      const rect = trigger.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 6, left: rect.left })
    }
    measure()
    window.addEventListener('resize', measure)
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) === true) return
      if (menuRef.current?.contains(target) === true) return
      setOpen(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('resize', measure)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const commit = async (selection: ModelSelection) => {
    if (busy) return
    setBusy(true)
    try {
      const accepted = await select(selection)
      if (accepted) setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setOpen(true)
    }
  }

  return (
    <div className="workflow-seat" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="workflow-seat-trigger"
        disabled={locked || !available}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={t('seatTitle')}
        onClick={() => setOpen(value => !value)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="workflow-seat-caption">{caption}</span>
        <span className="workflow-seat-chevron" aria-hidden="true">▾</span>
      </button>

      {open && menuPos !== null && createPortal(
        <div
          id={`${id}-menu`}
          ref={menuRef}
          role="menu"
          aria-label={t('seatTitle')}
          className="workflow-seat-menu"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <div className="workflow-seat-tabs" role="tablist" aria-label={t('seatTitle')}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'models'}
              className={`workflow-seat-tab${tab === 'models' ? ' active' : ''}`}
              onClick={() => setTab('models')}
            >
              {t('seatTabModels')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'workflows'}
              className={`workflow-seat-tab${tab === 'workflows' ? ' active' : ''}`}
              onClick={() => setTab('workflows')}
            >
              {t('seatTabWorkflows')}
            </button>
          </div>

          {tab === 'models' ? (
            <div className="workflow-seat-list">
              {state.status === 'loading' && modelRows.length === 0 && (
                <p className="workflow-seat-empty">{t('loading')}</p>
              )}
              {state.status === 'error' && (
                <p className="workflow-seat-empty workflow-seat-error">{state.error ?? t('error')}</p>
              )}
              {modelRows.length === 0 && state.status !== 'loading' && state.status !== 'error' && (
                <p className="workflow-seat-empty">{t('seatModelsEmpty')}</p>
              )}
              {groups.map(group => (
                <div key={group.id} className="workflow-seat-group">
                  <div className="workflow-seat-group-name">{group.name}</div>
                  {group.models.map(model => {
                    const active = current?.provider === group.id && current.model === model.id
                    return (
                      <button
                        key={rowId(group.id, model.id)}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        className={`workflow-seat-item${active ? ' active' : ''}`}
                        disabled={busy}
                        onClick={() => void commit({
                          provider: group.id,
                          model: model.id,
                          ...model.reasoning?.defaultEffort === undefined
                            ? {}
                            : { reasoningEffort: model.reasoning.defaultEffort },
                        })}
                      >
                        <span className="workflow-seat-item-name">{model.name}</span>
                        {active && <span className="workflow-seat-check" aria-hidden="true">✓</span>}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div className="workflow-seat-list">
              {workflows === null && workflowsError === null && (
                <p className="workflow-seat-empty">{t('loading')}</p>
              )}
              {workflowsError !== null && (
                <p className="workflow-seat-empty workflow-seat-error">{workflowsError}</p>
              )}
              {workflows !== null && workflows.length === 0 && (
                <p className="workflow-seat-empty">{t('seatWorkflowsEmpty')}</p>
              )}
              {workflowRows.map(row => (
                <button
                  key={row.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={row.active}
                  className={`workflow-seat-item${row.active ? ' active' : ''}`}
                  disabled={busy}
                  onClick={() => void commit({
                    provider: WORKFLOW_PROVIDER_ID,
                    model: row.workflow.name,
                  })}
                >
                  <span className="workflow-seat-item-name">
                    <span className="workflow-seat-badge">{t('seatWorkflowBadge')}</span>
                    {row.workflow.title || row.workflow.name}
                  </span>
                  {row.active && <span className="workflow-seat-check" aria-hidden="true">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}

export type { ModelProviderGroup, ModelSelection, WorkflowLocaleKey }
