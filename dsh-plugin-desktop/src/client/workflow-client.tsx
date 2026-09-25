import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { WorkflowPanel } from './WorkflowPanel.js'
import { WorkflowIcon, WorkflowLauncher } from './WorkflowLauncher.js'
import { WorkflowOverlay } from './WorkflowOverlay.js'
import { WorkflowModelSelect, WORKFLOW_PROVIDER_ID } from './WorkflowModelSelect.js'
import { createWorkflowStore } from './workflow-store.js'
import { createDesktopWorkflowApi } from './desktop-workflow-api.js'
import { en, zh, ja, ko } from './locales-workflow.js'
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

// Declared for symmetry with other client modules; the Cordis fiber privileges
// come from `src/client/index.ts` (this file is apply()'d, not loaded alone).
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

  // Built-in zh/en plus language-pack ja/ko for the workflow namespace.
  ctx.effect(() => ctx.locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en' }), 'dsh-plugin-desktop/workflow: language ja')
  ctx.effect(() => ctx.locale.addLanguage({ id: 'ko', label: '한국어', fallback: 'en' }), 'dsh-plugin-desktop/workflow: language ko')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-plugin-desktop/workflow: dictionaries zh/en')
  ctx.effect(() => ctx.locale.register(NS, 'ja', ja), 'dsh-plugin-desktop/workflow: dictionary ja')
  ctx.effect(() => ctx.locale.register(NS, 'ko', ko), 'dsh-plugin-desktop/workflow: dictionary ko')
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
  //
  // modelDirectories is read through a local face (not ui-model-selection/client):
  // that package merges ISessions onto Context.sessions, which collides with
  // Cordis SessionStore already pulled in by the desktop client entry and
  // erases the inject-narrowed locale/slots faces from this module's typecheck.
  //
  // Armed-workflow send sits on the seat (icon to the right of the caption);
  // there is no separate conversation.input.right recommend chip.
  ctx.inject(['slots', 'modelDirectories'], (rawScope) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
    const scope = rawScope as any
    const models = scope.modelDirectories
    const sessions = scope.sessions
    scope.slots.inject('conversation.input.model', () => scope.slots.register({
      name: 'conversation.input.model',
      locale: NS,
      priority: -1,
      inject: (sessionId: unknown) => {
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
          api,
          openRunsPanel,
          openSettingsPanel,
        }
      },
    }, WorkflowModelSelect))
  })
}
