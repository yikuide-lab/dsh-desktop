import {
  Button,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createWorkflowStore } from './workflow-store.js'
import { requestWorkflowPanelClose } from './workflow-leave-guard.js'

export type WorkflowLauncherProps = PropsRuntime<'sidebar.footer.action'>
  & PropsStore<ReturnType<typeof createWorkflowStore>>
  & PropsLocale<'dsh-plugin-desktop/workflow'>
  & {
    openWorkflowPanel: () => void
  }

/** Workflow icon for the sidebar launcher and panellist glyph. */
export function WorkflowIcon({ size = 16 }: { readonly size?: number }) {
  return (
    <svg
      data-icon="workflow"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2v6M12 18v4M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M2 12h6M18 12h4M4.93 19.07l4.24-4.24M14.83 9.17l4.24-4.24" />
    </svg>
  )
}

/**
 * Footer trigger that opens the centered workflow workbench overlay.
 * The surface itself lives on shell.overlay (WorkflowOverlay).
 */
export function WorkflowLauncher({
  wide,
  openWorkflowPanel,
  actions,
  useStore,
  t,
}: WorkflowLauncherProps) {
  const open = useStore(state => state.panelOpen)

  return (
    <div className="dshWorkflowLauncherLayer" data-wide={wide}>
      <Tooltip label={t('tab')} delayMs={500} disabled={wide || open}>
        <Button
          variant="ghost"
          className="dshWorkflowLauncher"
          data-wide={wide}
          data-active={open || undefined}
          aria-label={t('tab')}
          aria-haspopup="dialog"
          aria-expanded={open}
          icon={<WorkflowIcon size={wide ? 16 : 18} />}
          onClick={() => {
            if (open) {
              void (async () => {
                const allowed = await requestWorkflowPanelClose()
                if (allowed) actions.setPanelOpen(false)
              })()
              return
            }
            openWorkflowPanel()
          }}
        >
          {wide ? t('tab') : null}
        </Button>
      </Tooltip>
    </div>
  )
}
