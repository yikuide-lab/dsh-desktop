import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkflowViewStore, Workflow } from './workflow-store.js'
import type { DesktopWorkflowApi } from './desktop-workflow-api.js'
import { WorkflowList } from './WorkflowList.js'
import { WorkflowEditor } from './WorkflowEditor.js'
import { WorkflowRunView } from './WorkflowRunView.js'
import { WorkflowTemplateManager } from './WorkflowTemplateManager.js'
import { WorkflowSettingsPanel } from './WorkflowSettingsPanel.js'
import { WorkflowAwfPanel } from './WorkflowAwfPanel.js'
import { WorkflowTriggers } from './WorkflowTriggers.js'
import { WorkflowStats } from './WorkflowStats.js'
import {
  WorkflowIconChart,
  WorkflowIconGear,
  WorkflowIconLayers,
  WorkflowIconList,
  WorkflowIconNodes,
  WorkflowIconZap,
} from './WorkflowIcons.js'
import { RunResizeHandle } from './RunResizeHandle.js'
import {
  AWF_RAIL_COLLAPSED_WIDTH,
  AWF_RAIL_DEFAULT_WIDTH,
  AWF_RAIL_MAX_WIDTH,
  AWF_RAIL_MIN_WIDTH,
  AWF_RAIL_OPEN_STORAGE_KEY,
  AWF_RAIL_WIDTH_STORAGE_KEY,
  clampAwfRailWidth,
} from './workflow-awf-layout.js'

export type WorkflowPanelProps = PropsStore<WorkflowViewStore>
  & PropsLocale<'dsh-plugin-desktop/workflow'>
  & {
    api: DesktopWorkflowApi
    /** When false, omit the in-body title block (overlay already shows chrome). */
    showHeader?: boolean
    /** Absolute cwd of the active session when known. */
    sessionCwd?: string | undefined
  }

type Tab = 'workflows' | 'runs' | 'templates' | 'settings' | 'triggers' | 'stats'

/** Workflow manager body shared by the overlay workbench and optional main panel. */
export function WorkflowPanel({
  t,
  api,
  useStore,
  actions,
  showHeader = true,
  sessionCwd,
}: WorkflowPanelProps) {
  const activeTab = useStore(s => s.activeTab) as Tab
  const pendingTemplateYaml = useStore(s => s.pendingTemplateYaml)
  const statsFocusName = useStore(s => s.statsFocusName)
  const [showEditor, setShowEditor] = useState(false)
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null)
  const [initialYaml, setInitialYaml] = useState<string | null>(null)
  const [preferVisual, setPreferVisual] = useState(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [awfOpen, setAwfOpen] = useState(true)
  const [awfRailWidth, setAwfRailWidth] = useState<number>(AWF_RAIL_DEFAULT_WIDTH)
  const awfRailWidthRef = useRef<number>(AWF_RAIL_DEFAULT_WIDTH)
  const awfResizeStart = useRef<number>(AWF_RAIL_DEFAULT_WIDTH)
  const [awfResizing, setAwfResizing] = useState(false)

  const setAwfRailWidthPersist = (width: number) => {
    awfRailWidthRef.current = width
    setAwfRailWidth(width)
  }

  useEffect(() => {
    try {
      const rawWidth = window.localStorage.getItem(AWF_RAIL_WIDTH_STORAGE_KEY)
      if (rawWidth) {
        const parsed = Number(rawWidth)
        if (!Number.isNaN(parsed)) {
          const clamped = Math.min(AWF_RAIL_MAX_WIDTH, Math.max(AWF_RAIL_MIN_WIDTH, Math.round(parsed)))
          awfRailWidthRef.current = clamped
          setAwfRailWidth(clamped)
        }
      }
      const rawOpen = window.localStorage.getItem(AWF_RAIL_OPEN_STORAGE_KEY)
      if (rawOpen === '0') setAwfOpen(false)
      else if (rawOpen === '1') setAwfOpen(true)
    } catch {
      // storage unavailable — keep the defaults
    }
  }, [])

  const persistAwfOpen = (open: boolean) => {
    setAwfOpen(open)
    try {
      window.localStorage.setItem(AWF_RAIL_OPEN_STORAGE_KEY, open ? '1' : '0')
    } catch {
      // storage unavailable
    }
  }

  const persistAwfRailWidth = () => {
    try {
      window.localStorage.setItem(AWF_RAIL_WIDTH_STORAGE_KEY, String(awfRailWidthRef.current))
    } catch {
      // storage unavailable
    }
  }

  const handleAwfResizeStart = () => {
    awfResizeStart.current = awfRailWidthRef.current
    setAwfResizing(true)
  }

  const handleAwfResize = (delta: number) => {
    const container = bodyRef.current?.clientWidth ?? 0
    setAwfRailWidthPersist(clampAwfRailWidth(awfResizeStart.current + delta, container || window.innerWidth))
  }

  const handleAwfResizeEnd = () => {
    setAwfResizing(false)
    persistAwfRailWidth()
  }

  const handleAwfNudge = (deltaPx: number) => {
    const container = bodyRef.current?.clientWidth ?? 0
    setAwfRailWidthPersist(clampAwfRailWidth(awfRailWidthRef.current + deltaPx, container || window.innerWidth))
    persistAwfRailWidth()
  }

  useEffect(() => {
    if (pendingTemplateYaml) {
      setEditingWorkflow(null)
      setInitialYaml(pendingTemplateYaml)
      setPreferVisual(true)
      setShowEditor(true)
      actions.setPendingTemplateYaml(null)
      actions.setActiveTab('workflows')
    }
  }, [pendingTemplateYaml, actions])

  const handleCreate = () => {
    setEditingWorkflow(null)
    setInitialYaml(null)
    setPreferVisual(false)
    setShowEditor(true)
  }

  const handleEdit = (workflow: Workflow) => {
    setEditingWorkflow(workflow)
    setInitialYaml(null)
    setPreferVisual(true)
    setShowEditor(true)
  }

  const handleCopyWorkflow = (yaml: string) => {
    setEditingWorkflow(null)
    setInitialYaml(yaml)
    setPreferVisual(true)
    setShowEditor(true)
  }

  const handleSave = () => {
    setShowEditor(false)
    setEditingWorkflow(null)
    setInitialYaml(null)
    setPreferVisual(false)
  }

  const handleCancel = () => {
    setShowEditor(false)
    setEditingWorkflow(null)
    setInitialYaml(null)
    setPreferVisual(false)
  }

  if (showEditor) {
    return (
      <WorkflowEditor
        workflow={editingWorkflow}
        initialYaml={initialYaml}
        preferVisual={preferVisual}
        api={api}
        onSave={handleSave}
        onCancel={handleCancel}
        t={t}
      />
    )
  }

  return (
    <div className="workflow-panel" data-embedded={showHeader ? undefined : 'true'}>
      {showHeader && (
        <div className="workflow-header">
          <h2>{t('title')}</h2>
          <p>{t('subtitle')}</p>
        </div>
      )}

      <div className="workflow-tabs">
        <button
          type="button"
          className={`workflow-tab ${activeTab === 'workflows' ? 'active' : ''}`}
          onClick={() => actions.setActiveTab('workflows')}
        >
          <span className="workflow-btn-icon"><WorkflowIconNodes /></span>
          {t('workflowsTab')}
        </button>
        <button
          type="button"
          className={`workflow-tab ${activeTab === 'runs' ? 'active' : ''}`}
          onClick={() => actions.setActiveTab('runs')}
        >
          <span className="workflow-btn-icon"><WorkflowIconList /></span>
          {t('runs')}
        </button>
        <button
          type="button"
          className={`workflow-tab ${activeTab === 'templates' ? 'active' : ''}`}
          onClick={() => actions.setActiveTab('templates')}
        >
          <span className="workflow-btn-icon"><WorkflowIconLayers /></span>
          {t('templates')}
        </button>
        <button
          type="button"
          className={`workflow-tab ${activeTab === 'triggers' ? 'active' : ''}`}
          onClick={() => actions.setActiveTab('triggers')}
        >
          <span className="workflow-btn-icon"><WorkflowIconZap /></span>
          {t('triggersTab')}
        </button>
        <button
          type="button"
          className={`workflow-tab ${activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => actions.setActiveTab('stats')}
        >
          <span className="workflow-btn-icon"><WorkflowIconChart /></span>
          {t('statsTab')}
        </button>
        <button
          type="button"
          className={`workflow-tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => actions.setActiveTab('settings')}
        >
          <span className="workflow-btn-icon"><WorkflowIconGear /></span>
          {t('settingsTab')}
        </button>
      </div>

      <div
        className="workflow-body"
        ref={bodyRef}
        data-resizing={awfResizing ? 'awf-rail' : undefined}
      >
      <div className="workflow-content">
        {activeTab === 'workflows' && (
          <WorkflowList
            api={api}
            onCreate={handleCreate}
            onEdit={handleEdit}
            onCopy={handleCopyWorkflow}
            onRunStarted={() => actions.setActiveTab('runs')}
            onOpenSettings={() => actions.setActiveTab('settings')}
            onOpenStats={(name) => {
              actions.setStatsFocusName(name)
              actions.setActiveTab('stats')
            }}
            {...(sessionCwd ? { sessionCwd } : {})}
            t={t}
          />
        )}
        {activeTab === 'runs' && (
          <WorkflowRunView
            api={api}
            t={t}
            useStore={useStore}
            actions={actions}
          />
        )}
        {activeTab === 'templates' && (
          <WorkflowTemplateManager
            api={api}
            onUseTemplate={(yaml) => {
              actions.setPendingTemplateYaml(yaml)
            }}
            t={t}
          />
        )}
        {activeTab === 'triggers' && (
          <WorkflowTriggers api={api} t={t} />
        )}
        {activeTab === 'stats' && (
          <WorkflowStats
            api={api}
            t={t}
            focusName={statsFocusName}
            onFocusConsumed={() => actions.setStatsFocusName(null)}
            onOpenRun={(runId) => {
              actions.setFocusRunId(runId)
              actions.setActiveTab('runs')
            }}
          />
        )}
        {activeTab === 'settings' && (
          <WorkflowSettingsPanel api={api} t={t} />
        )}
      </div>

      {awfOpen && (
        <RunResizeHandle
          label={t('resizeAwfRail')}
          value={awfRailWidth}
          onStart={handleAwfResizeStart}
          onDrag={handleAwfResize}
          onEnd={handleAwfResizeEnd}
          onNudge={handleAwfNudge}
        />
      )}

      <aside
        className={`workflow-awf-rail${awfOpen ? '' : ' is-collapsed'}`}
        aria-label={t('awfTitle')}
        style={awfOpen ? { width: awfRailWidth } : { width: AWF_RAIL_COLLAPSED_WIDTH }}
      >
        <div className="workflow-awf-rail-head">
          <button
            type="button"
            className="workflow-awf-rail-toggle"
            aria-expanded={awfOpen}
            aria-label={t('awfRailToggle')}
            title={t('awfRailToggle')}
            onClick={() => persistAwfOpen(!awfOpen)}
          >
            {awfOpen ? '»' : '«'}
          </button>
          {!awfOpen && <span className="workflow-awf-rail-stub">{t('awfTitle')}</span>}
        </div>
        {awfOpen && (
          <div className="workflow-awf-rail-body">
            <WorkflowAwfPanel api={api} t={t} />
          </div>
        )}
      </aside>
      </div>
    </div>
  )
}
