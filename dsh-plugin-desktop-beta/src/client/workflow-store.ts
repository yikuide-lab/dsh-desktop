import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type {
  WorkflowRunView,
  WorkflowTemplateView,
  WorkflowView,
  WorkspaceBindingView,
} from './desktop-workflow-api.js'

export type {
  WorkflowStepView as WorkflowStep,
  WorkflowView as Workflow,
  WorkflowRunView as WorkflowRun,
  WorkflowTemplateView as WorkflowTemplate,
  PendingGateView,
  WorkspaceBindingView,
} from './desktop-workflow-api.js'

export interface WorkflowViewState {
  workflows: WorkflowView[]
  runs: WorkflowRunView[]
  templates: WorkflowTemplateView[]
  selectedWorkflow: WorkflowView | null
  selectedRun: WorkflowRunView | null
  pendingTemplateYaml: string | null
  activeTab: 'workflows' | 'runs' | 'templates' | 'settings' | 'triggers' | 'stats'
  /** Prefill stats detail when opening the stats tab from a list card. */
  statsFocusName: string | null
  /** Prefill run selection when jumping from stats recent runs. */
  focusRunId: string | null
  /** Whether the floating workflow surface owned by the sidebar launcher is open. */
  panelOpen: boolean
  binding: WorkspaceBindingView | null
  isLoading: boolean
  error: string | null
}

export type WorkflowViewActions = {
  setWorkflows: (draft: WorkflowViewState, workflows: WorkflowView[]) => void
  setRuns: (draft: WorkflowViewState, runs: WorkflowRunView[]) => void
  setTemplates: (draft: WorkflowViewState, templates: WorkflowTemplateView[]) => void
  selectWorkflow: (draft: WorkflowViewState, workflow: WorkflowView | null) => void
  selectRun: (draft: WorkflowViewState, run: WorkflowRunView | null) => void
  setPendingTemplateYaml: (draft: WorkflowViewState, yaml: string | null) => void
  setActiveTab: (draft: WorkflowViewState, tab: 'workflows' | 'runs' | 'templates' | 'settings' | 'triggers' | 'stats') => void
  setStatsFocusName: (draft: WorkflowViewState, name: string | null) => void
  setFocusRunId: (draft: WorkflowViewState, runId: string | null) => void
  setPanelOpen: (draft: WorkflowViewState, open: boolean) => void
  setBinding: (draft: WorkflowViewState, binding: WorkspaceBindingView | null) => void
  setLoading: (draft: WorkflowViewState, loading: boolean) => void
  setError: (draft: WorkflowViewState, error: string | null) => void
  addWorkflow: (draft: WorkflowViewState, workflow: WorkflowView) => void
  updateWorkflow: (draft: WorkflowViewState, workflow: WorkflowView) => void
  removeWorkflow: (draft: WorkflowViewState, name: string) => void
  addRun: (draft: WorkflowViewState, run: WorkflowRunView) => void
  updateRun: (draft: WorkflowViewState, run: WorkflowRunView) => void
}

export function createWorkflowStore(): EngineStoreHandle<WorkflowViewState, WorkflowViewActions> {
  return defineStore({
    init: (): WorkflowViewState => ({
      workflows: [],
      runs: [],
      templates: [],
      selectedWorkflow: null,
      selectedRun: null,
      pendingTemplateYaml: null,
      activeTab: 'workflows',
      statsFocusName: null,
      focusRunId: null,
      panelOpen: false,
      binding: null,
      isLoading: false,
      error: null,
    }),
    actions: {
      setWorkflows: (draft, workflows) => { draft.workflows = workflows },
      setRuns: (draft, runs) => { draft.runs = runs },
      setTemplates: (draft, templates) => { draft.templates = templates },
      selectWorkflow: (draft, workflow) => { draft.selectedWorkflow = workflow },
      selectRun: (draft, run) => { draft.selectedRun = run },
      setPendingTemplateYaml: (draft, yaml) => { draft.pendingTemplateYaml = yaml },
      setActiveTab: (draft, tab) => { draft.activeTab = tab },
      setStatsFocusName: (draft, name) => { draft.statsFocusName = name },
      setFocusRunId: (draft, runId) => { draft.focusRunId = runId },
      setPanelOpen: (draft, open) => { draft.panelOpen = open },
      setBinding: (draft, binding) => { draft.binding = binding },
      setLoading: (draft, loading) => { draft.isLoading = loading },
      setError: (draft, error) => { draft.error = error },
      addWorkflow: (draft, workflow) => { draft.workflows.push(workflow) },
      updateWorkflow: (draft, workflow) => {
        const index = draft.workflows.findIndex((w) => w.name === workflow.name)
        if (index !== -1) draft.workflows[index] = workflow
      },
      removeWorkflow: (draft, name) => {
        draft.workflows = draft.workflows.filter((w) => w.name !== name)
      },
      addRun: (draft, run) => { draft.runs.push(run) },
      updateRun: (draft, run) => {
        const index = draft.runs.findIndex((r) => r.id === run.id)
        if (index !== -1) draft.runs[index] = run
      },
    },
  })
}

export type WorkflowViewStore = ReturnType<typeof createWorkflowStore>
