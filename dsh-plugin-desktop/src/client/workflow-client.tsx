import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
// Type-only: pulls upstream's ctx.modelDirectories Context merge (the shared
// per-session model directory both selection entries read). No runtime edge.
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { WorkflowPanel } from './WorkflowPanel.js'
import { WorkflowIcon, WorkflowLauncher } from './WorkflowLauncher.js'
import { WorkflowOverlay } from './WorkflowOverlay.js'
import { WorkflowRecommend } from './WorkflowRecommend.js'
import { WorkflowModelSelect, WORKFLOW_PROVIDER_ID } from './WorkflowModelSelect.js'
import { createWorkflowStore } from './workflow-store.js'
import { createDesktopWorkflowApi } from './desktop-workflow-api.js'
import { en, zh } from './locales-workflow.js'
import { installWorkflowStyles } from './styles-workflow.js'
import { WORKFLOW_PANEL_ID } from './workflow-layout.js'
import { currentWorkspaceId, pickCurrentSessionCwd } from './workflow-run-params.js'
import { buildArmCandidate } from './workflow-recommend-candidates.js'
import { buildSeatWorkflowRows } from './seat-workflows.js'
import { setArmedWorkflow } from './workflow-arm.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-plugin-desktop/workflow': WorkflowLocaleKey
  }
}

export const inject = ['slots', 'locale']
export const NS = 'dsh-plugin-desktop/workflow'
export { WORKFLOW_PANEL_ID, resolveLayout, selectWorkflowPanel } from './workflow-layout.js'

type WorkflowPanelIconProps = PropsRuntime<'sidebar.panellist'> & {
  openWorkflowPanel: () => void
}

/**
 * Panellist glyph that opens the floating workflow surface.
 * Stops propagation so the shell's selectPanel(id) path cannot swallow the click.
 */
function WorkflowPanelIcon({ size, openWorkflowPanel }: WorkflowPanelIconProps) {
  return (
    <span
      className="dshWorkflowPanelIcon"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        openWorkflowPanel()
      }}
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <WorkflowIcon size={size} />
    </span>
  )
}

/** Register workflow floating launcher, panellist glyph, optional main panel, locale, and styles. */
export function applyWorkflowClient(ctx: ClientContext): void {
  const workflowViewHandle = createWorkflowStore()
  const workflowView = workflowViewHandle.create()
  const workflowStore = { ...workflowViewHandle, create: () => workflowView }
  const api = createDesktopWorkflowApi()

  const openWorkflowPanel = (): void => {
    workflowView.actions.setActiveTab('workflows')
    workflowView.actions.setPanelOpen(true)
  }

  const openRunsPanel = (): void => {
    workflowView.actions.setActiveTab('runs')
    workflowView.actions.setPanelOpen(true)
  }

  const openSettingsPanel = (): void => {
    workflowView.actions.setActiveTab('settings')
    workflowView.actions.setPanelOpen(true)
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-plugin-desktop/workflow: dictionaries')
  ctx.effect(() => installWorkflowStyles(), 'dsh-plugin-desktop/workflow: styles')

  // Best-effort main panel for environments where selectPanel works.
  ctx.slots.inject('main', function* () {
    yield ctx.slots.register({
      name: 'main',
      key: WORKFLOW_PANEL_ID,
      locale: NS,
      store: workflowStore,
      inject: () => ({ api }),
    }, function WorkflowMainPanel(props: PropsRuntime<'main'> & Parameters<typeof WorkflowPanel>[0]) {
      const sessionCwd = props.useSessions((state) => pickCurrentSessionCwd(state))
      return <WorkflowPanel {...props} {...(sessionCwd ? { sessionCwd } : {})} />
    })
  })

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: WORKFLOW_PANEL_ID,
    order: 45,
    label: () => ctx.locale.bind(NS)('tab'),
    locale: NS,
    inject: () => ({ openWorkflowPanel }),
  }, WorkflowPanelIcon))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: WORKFLOW_PANEL_ID,
    order: 15,
    label: () => ctx.locale.bind(NS)('tab'),
    locale: NS,
    store: workflowStore,
    inject: () => ({ openWorkflowPanel }),
  }, WorkflowLauncher))

  // Centered workbench (Market-style). Declared by upstream AppFrame and
  // desktop-owned shells; inject is a no-op until the seat exists.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: WORKFLOW_PANEL_ID,
    order: 20,
    locale: NS,
    store: workflowStore,
    inject: () => ({ api }),
  }, WorkflowOverlay))

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'workflow-recommend',
    order: 40,
    locale: NS,
    // Do not attach workflowStore here: that handle is already pinned to root
    // (main / footer / overlay). Session+root reuse throws "one handle, one scope".
    inject: () => ({ api, openRunsPanel, openWorkflowPanel, openSettingsPanel }),
  }, WorkflowRecommend))

  // The composer's model seat: one unified models + workflows menu. Priority -1
  // shadows upstream's stock ModelSelect: the slot spec renders the LOWEST
  // priority and rejects a second same-priority registration, so this is the
  // supported "replace a documented slot" path. Upstream stays loaded for its
  // /model popup and the shared ctx.modelDirectories, which the seat reads
  // unchanged.
  // Mirror the stock ModelSelect's proven wait list: the callback registers
  // through `slots`, so `slots` must be in the wait list itself — waiting on
  // `sessions` instead let this callback fire before `slots` existed and die
  // silently, which is how the seat never mounted. `sessions` is read from the
  // scope the same way the stock does once those services have landed.
  ctx.inject(['slots', 'modelDirectories'], (scope) => {
    const models = scope.modelDirectories
    const sessions = scope.sessions
    scope.slots.inject('conversation.input.model', () => scope.slots.register({
      name: 'conversation.input.model',
      locale: NS,
      priority: -1,
      inject: (sessionId) => {
        const directory = models.directoryFor(sessionId)
        const available = sessions.subagentAddress(sessionId) === undefined
        return {
          available,
          directory: directory.store,
          load: () => {
            if (available) directory.load().catch(() => { /* surfaced on the store */ })
          },
          select: async (selection: ModelSelection) => {
            if (!available) return false
            if (selection.provider === WORKFLOW_PROVIDER_ID) {
              // Picking a workflow in the unified seat arms it as the composer's
              // submit target; picking a model returns to plain model chat.
              const [workflows, templates, binding] = await Promise.all([
                api.listWorkflows().catch(() => []),
                api.listTemplates().catch(() => []),
                api.getBinding(currentWorkspaceId()).catch(() => null),
              ])
              setArmedWorkflow(buildArmCandidate({
                bindingName: binding?.workflowName ?? null,
                workflows,
                templates,
                workflowName: selection.model,
              }))
            } else {
              setArmedWorkflow(null)
            }
            return directory.select(selection).then(() => true, () => false)
          },
          listWorkflows: () => api.listWorkflows().then(async local => {
            // The workflow tab lists every armable source: saved workflows,
            // templates, and the platform's public/private summaries.
            const [templates, remote] = await Promise.all([
              api.listTemplates().catch(() => []),
              api.pullAwfWorkflows().catch(() => []),
            ])
            return buildSeatWorkflowRows({ workflows: local, templates, remote })
              .map(entry => ({ ...entry, steps: [] }))
          }),
        }
      },
    }, WorkflowModelSelect))
  })
}
