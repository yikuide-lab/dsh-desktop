import {
  Button,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createSessionImportStore } from './session-import-store.js'

export type SessionImportLauncherProps = PropsRuntime<'sidebar.footer.action'>
  & PropsStore<ReturnType<typeof createSessionImportStore>>
  & PropsLocale<'dsh-plugin-desktop/session-import'>
  & {
    openSessionImportPanel: () => void
  }

function ImportIcon({ size = 16 }: { readonly size?: number }) {
  return (
    <svg
      data-icon="session-import"
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
      <path d="M12 3v12" />
      <path d="m8 11 4 4 4-4" />
      <path d="M4 19h16" />
    </svg>
  )
}

/** Footer trigger that opens the harness session-import overlay. */
export function SessionImportLauncher({
  wide,
  openSessionImportPanel,
  actions,
  useStore,
  t,
}: SessionImportLauncherProps) {
  const open = useStore(state => state.panelOpen)
  return (
    <div className="dshSessionImportLauncherLayer" data-wide={wide}>
      <Tooltip label={t('tab')} delayMs={500} disabled={wide || open}>
        <Button
          variant="ghost"
          className="dshSessionImportLauncher"
          data-wide={wide}
          data-active={open || undefined}
          aria-label={t('tab')}
          aria-haspopup="dialog"
          aria-expanded={open}
          icon={<ImportIcon size={wide ? 16 : 18} />}
          onClick={() => {
            if (open) {
              actions.setPanelOpen(false)
              return
            }
            openSessionImportPanel()
          }}
        >
          {wide ? t('tab') : null}
        </Button>
      </Tooltip>
    </div>
  )
}
