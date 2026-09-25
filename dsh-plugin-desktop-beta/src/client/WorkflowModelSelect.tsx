import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ModelSelection, ModelProviderGroup } from '@deepseek-ai/dsh-api-session-controller/types'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import { readSeatPins, toggleSeatPin, SEAT_PINS_STORAGE_KEY } from './seat-pins.js'
import { getArmedWorkflow, subscribeArmedWorkflow } from './workflow-arm.js'
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
 * mirror upstream `ModelSelectInjected` so model rows keep stock behaviour;
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

/** One selectable row of a tab: a model or a workflow. */
interface SeatRow {
  key: string
  kind: 'model' | 'workflow'
  name: string
  selection: ModelSelection
  active: boolean
  /** Provider group the row belongs to (models only), for grouped rendering. */
  group?: ModelProviderGroup
}

/**
 * The composer's model seat: ONE dropdown carrying models and workflows,
 * separated by tabs (常规模型 / 工作流) inside the menu.
 *
 * Occupies `conversation.input.model` at a lower priority than upstream so this
 * component shadows the stock ModelSelect (the slot spec renders the lowest
 * priority). Any row can be pinned to the 置顶 section at the top of its tab;
 * pins persist per user in localStorage. The refresh control re-reads the model
 * directory and refetches the workflow rows in place.
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
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('models')
  const [workflows, setWorkflows] = useState<WorkflowView[] | null>(null)
  const [workflowsError, setWorkflowsError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [pins, setPins] = useState<string[]>(() => {
    try {
      return readSeatPins(window.localStorage.getItem(SEAT_PINS_STORAGE_KEY))
    } catch {
      return []
    }
  })
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const [id] = useState(newId)

  const groups = state.groups
  const current = state.current
  // Armed workflow is the composer's submit target; prefer its title for the
  // trigger caption so a successful arm is visible even when the directory's
  // workflow route has not (or cannot) land as `current`.
  const armed = useSyncExternalStore(subscribeArmedWorkflow, getArmedWorkflow, getArmedWorkflow)

  useEffect(() => {
    try {
      window.localStorage.setItem(SEAT_PINS_STORAGE_KEY, JSON.stringify(pins))
    } catch {
      // Storage unavailable (private mode): pins stay in-memory for this session.
    }
  }, [pins])

  // One flat row set: models mirror upstream's flattening (one row per
  // provider/model), workflows join as rows of the `workflow` pseudo-provider.
  const rows = useMemo<SeatRow[]>(() => [
    ...groups.flatMap(group => group.models.map((model): SeatRow => ({
      key: rowId(group.id, model.id),
      kind: 'model',
      name: model.name,
      group,
      selection: {
        provider: group.id,
        model: model.id,
        ...model.reasoning?.defaultEffort === undefined
          ? {}
          : { reasoningEffort: model.reasoning.defaultEffort },
      },
      active: current?.provider === group.id && current.model === model.id,
    }))),
    ...(workflows ?? []).map((workflow): SeatRow => ({
      key: rowId(WORKFLOW_PROVIDER_ID, workflow.name),
      kind: 'workflow',
      name: workflow.title || workflow.name,
      selection: { provider: WORKFLOW_PROVIDER_ID, model: workflow.name },
      active: current?.provider === WORKFLOW_PROVIDER_ID && current.model === workflow.name,
    })),
  ], [groups, workflows, current])

  // Pinned rows lead their tab in pin order (most recent first); everything
  // else keeps the directory's grouping and never duplicates a pinned row.
  const pinnedRows = useMemo(() => {
    const byKey = new Map(rows.map(row => [row.key, row]))
    return pins
      .map(key => byKey.get(key))
      .filter((row): row is SeatRow => row !== undefined)
  }, [rows, pins])
  const pinnedKeys = useMemo(() => new Set(pinnedRows.map(row => row.key)), [pinnedRows])
  const pinnedModelRows = useMemo(
    () => pinnedRows.filter(row => row.kind === 'model'),
    [pinnedRows],
  )
  const pinnedWorkflowRows = useMemo(
    () => pinnedRows.filter(row => row.kind === 'workflow'),
    [pinnedRows],
  )
  const freeWorkflowRows = useMemo(
    () => rows.filter(row => row.kind === 'workflow' && !pinnedKeys.has(row.key)),
    [rows, pinnedKeys],
  )
  const freeModelGroups = useMemo(() => groups
    .map(group => ({
      group,
      rows: rows.filter(row => row.group === group && !pinnedKeys.has(row.key)),
    }))
    .filter(entry => entry.rows.length > 0), [groups, rows, pinnedKeys])

  // Trigger caption: armed workflow title, else selected model/workflow name.
  const caption = useMemo(() => {
    if (armed !== null) {
      return `${t('seatWorkflowBadge')}: ${armed.title || armed.workflowName}`
    }
    if (current === null) return t('seatModelAuto')
    if (current.provider === WORKFLOW_PROVIDER_ID) {
      const match = (workflows ?? []).find(entry => entry.name === current.model)
      const label = match?.title || current.model
      return `${t('seatWorkflowBadge')}: ${label}`
    }
    const group = groups.find(entry => entry.id === current.provider)
    const model = group?.models.find(entry => entry.id === current.model)
    const label = model?.name ?? `${current.provider}/${current.model}`
    return `${t('modeModelShort')}: ${label}`
  }, [armed, current, groups, workflows, t])

  useEffect(() => {
    if (!open) return
    load()
  }, [open, load])

  // Load the workflow rows once per menu open. The injected `listWorkflows` is
  // a closure the slot machinery may rebuild per render, so it must NOT sit in
  // the effect deps with a cancelling cleanup — that restarts the fetch on
  // every render and the rows never land (the workflows tab spins forever).
  const loadedForOpen = useRef(false)
  useEffect(() => {
    if (!open) {
      loadedForOpen.current = false
      return
    }
    if (loadedForOpen.current) return
    loadedForOpen.current = true
    void listWorkflows().then(rows => {
      setWorkflows(rows)
      setRefreshing(false)
    }, (error: unknown) => {
      setWorkflowsError(error instanceof Error ? error.message : String(error))
      setRefreshing(false)
    })
  })

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

  // Manual refresh: re-read the model directory (llm providers + api keys pick
  // up stale or newly added models) and refetch the workflow rows (local saves,
  // templates, and the platform's public/private list).
  const refreshSeat = () => {
    setRefreshing(true)
    setWorkflowsError(null)
    setWorkflows(null)
    loadedForOpen.current = false
    load()
  }

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setOpen(true)
    }
  }

  const renderRow = (row: SeatRow) => {
    const pinned = pinnedKeys.has(row.key)
    return (
      <div key={row.key} className="workflow-seat-row">
        <button
          type="button"
          role="menuitemradio"
          aria-checked={row.active}
          className={`workflow-seat-item${row.active ? ' active' : ''}`}
          disabled={busy}
          onClick={() => void commit(row.selection)}
        >
          <span className="workflow-seat-item-name">
            {row.kind === 'workflow' && (
              <span className="workflow-seat-badge">{t('seatWorkflowBadge')}</span>
            )}
            {row.name}
          </span>
          {row.active && <span className="workflow-seat-check" aria-hidden="true">✓</span>}
        </button>
        <button
          type="button"
          className={`workflow-seat-pin${pinned ? ' active' : ''}`}
          aria-pressed={pinned}
          aria-label={pinned ? t('seatUnpin') : t('seatPin')}
          title={pinned ? t('seatUnpin') : t('seatPin')}
          onClick={() => setPins(previous => toggleSeatPin(previous, row.key))}
        >
          <span aria-hidden="true">📌</span>
        </button>
      </div>
    )
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
          <div className="workflow-seat-head">
            <span className="workflow-seat-head-name">{t('seatTitle')}</span>
            <button
              type="button"
              className="workflow-seat-refresh"
              disabled={refreshing}
              aria-label={t('seatRefresh')}
              title={t('seatRefresh')}
              onClick={refreshSeat}
            >
              <span aria-hidden="true">⟲</span>
              {t('seatRefresh')}
            </button>
          </div>

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
              {rows.some(row => row.kind === 'workflow') && (
                <span className="workflow-seat-tab-count">
                  {rows.filter(row => row.kind === 'workflow').length}
                </span>
              )}
            </button>
          </div>

          <div className="workflow-seat-list">
            {tab === 'models' ? (
              <>
                {state.status === 'loading' && rows.length === 0 && (
                  <p className="workflow-seat-empty">{t('loading')}</p>
                )}
                {state.status === 'error' && (
                  <p className="workflow-seat-empty workflow-seat-error">{state.error ?? t('error')}</p>
                )}
                {pinnedModelRows.length > 0 && (
                  <div className="workflow-seat-group">
                    <div className="workflow-seat-group-name">{t('seatPinned')}</div>
                    {pinnedModelRows.map(renderRow)}
                  </div>
                )}
                {freeModelGroups.map(entry => (
                  <div key={entry.group.id} className="workflow-seat-group">
                    <div className="workflow-seat-group-name">{entry.group.name}</div>
                    {entry.rows.map(renderRow)}
                  </div>
                ))}
                {state.status !== 'loading' && state.status !== 'error'
                  && pinnedModelRows.length === 0 && freeModelGroups.length === 0 && (
                  <p className="workflow-seat-empty">{t('seatModelsEmpty')}</p>
                )}
              </>
            ) : (
              <>
                {workflows === null && workflowsError === null && (
                  <p className="workflow-seat-empty">{t('loading')}</p>
                )}
                {workflowsError !== null && (
                  <p className="workflow-seat-empty workflow-seat-error">{workflowsError}</p>
                )}
                {pinnedWorkflowRows.length > 0 && (
                  <div className="workflow-seat-group">
                    <div className="workflow-seat-group-name">{t('seatPinned')}</div>
                    {pinnedWorkflowRows.map(renderRow)}
                  </div>
                )}
                {freeWorkflowRows.length > 0 && (
                  <div className="workflow-seat-group">
                    <div className="workflow-seat-group-name">{t('seatWorkflowBadge')}</div>
                    {freeWorkflowRows.map(renderRow)}
                  </div>
                )}
                {workflows !== null && pinnedWorkflowRows.length === 0 && freeWorkflowRows.length === 0 && (
                  <p className="workflow-seat-empty">{t('seatWorkflowsEmpty')}</p>
                )}
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

export type { ModelProviderGroup, ModelSelection, WorkflowLocaleKey }
