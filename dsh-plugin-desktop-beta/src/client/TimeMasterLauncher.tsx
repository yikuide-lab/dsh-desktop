import {
  Button,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createTimeMasterStore } from './time-master-store.js'

export type TimeMasterLauncherProps = PropsRuntime<'sidebar.footer.action'>
  & PropsStore<ReturnType<typeof createTimeMasterStore>>
  & PropsLocale<'dsh-plugin-desktop/time-master'>
  & {
    openTimeMasterPanel: () => void
  }

function ClockIcon({ size = 16 }: { readonly size?: number }) {
  return (
    <svg
      data-icon="time-master"
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
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

/** Footer trigger that opens the Time Master overlay. */
export function TimeMasterLauncher({
  wide,
  openTimeMasterPanel,
  actions,
  useStore,
  t,
}: TimeMasterLauncherProps) {
  const open = useStore(state => state.panelOpen)
  return (
    <div className="dshTimeMasterLauncherLayer" data-wide={wide}>
      <Tooltip label={t('tab')} delayMs={500} disabled={wide || open}>
        <Button
          variant="ghost"
          className="dshTimeMasterLauncher"
          data-wide={wide}
          data-active={open || undefined}
          aria-label={t('tab')}
          aria-haspopup="dialog"
          aria-expanded={open}
          icon={<ClockIcon size={wide ? 16 : 18} />}
          onClick={() => {
            if (open) {
              actions.setPanelOpen(false)
              return
            }
            openTimeMasterPanel()
          }}
        >
          {wide ? t('tab') : null}
        </Button>
      </Tooltip>
    </div>
  )
}
