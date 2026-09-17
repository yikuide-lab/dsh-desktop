import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  Button,
  IconCloseOutline16,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createWorkflowStore } from './workflow-store.js'
import type { DesktopWorkflowApi } from './desktop-workflow-api.js'
import { pickCurrentSessionCwd } from './workflow-run-params.js'
import { WorkflowPanel } from './WorkflowPanel.js'
import {
  requestWorkflowPanelClose,
  WorkflowLeaveGuardProvider,
} from './workflow-leave-guard.js'

export type WorkflowOverlayProps = PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createWorkflowStore>>
  & PropsLocale<'dsh-plugin-desktop/workflow'>
  & { api: DesktopWorkflowApi }

/** Previous fixed size was 1180×900; default is one-third larger. */
const DEFAULT_WIDTH = Math.round(1180 * 4 / 3)
const DEFAULT_HEIGHT = Math.round(900 * 4 / 3)
const MIN_WIDTH = 720
const MIN_HEIGHT = 480
const VIEWPORT_PAD = 56

type ResizeEdge = 'e' | 's' | 'se'

function clampSize(width: number, height: number): { width: number; height: number } {
  const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - VIEWPORT_PAD)
  const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - VIEWPORT_PAD)
  return {
    width: Math.min(maxWidth, Math.max(MIN_WIDTH, Math.round(width))),
    height: Math.min(maxHeight, Math.max(MIN_HEIGHT, Math.round(height))),
  }
}

/**
 * Centered workflow workbench on shell.overlay (Market-style).
 * Replaces the cramped sidebar-anchored floating popover.
 */
export function WorkflowOverlay({
  useStore,
  actions,
  api,
  t,
  useSessions,
}: WorkflowOverlayProps) {
  const open = useStore(state => state.panelOpen)
  const panel = useRef<HTMLElement>(null)
  const sessionCwd = useSessions((state) => pickCurrentSessionCwd(state))
  const [size, setSize] = useState(() => clampSize(DEFAULT_WIDTH, DEFAULT_HEIGHT))
  const [resizing, setResizing] = useState(false)
  /** Once the user drags a resize handle, keep that size (only clamp to viewport). */
  const userResized = useRef(false)
  const resize = useRef<{
    edge: ResizeEdge
    startX: number
    startY: number
    startW: number
    startH: number
  } | null>(null)
  const frame = useRef<number | null>(null)
  const latest = useRef({ x: 0, y: 0 })

  const closePanel = useCallback(() => {
    void (async () => {
      const allowed = await requestWorkflowPanelClose()
      if (allowed) actions.setPanelOpen(false)
    })()
  }, [actions])

  useEffect(() => {
    if (!open) {
      userResized.current = false
      return
    }
    setSize(clampSize(DEFAULT_WIDTH, DEFAULT_HEIGHT))
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (document.querySelector('[role="alertdialog"]')) return
      if (document.querySelectorAll('[role="dialog"]').length > 1) return
      closePanel()
    }
    const onWindowResize = (): void => {
      setSize((current) => (
        userResized.current
          ? clampSize(current.width, current.height)
          : clampSize(DEFAULT_WIDTH, DEFAULT_HEIGHT)
      ))
    }
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onWindowResize)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onWindowResize)
    }
  }, [closePanel, open])

  const applyResize = useCallback(() => {
    frame.current = null
    const active = resize.current
    if (!active) return
    const dx = latest.current.x - active.startX
    const dy = latest.current.y - active.startY
    const nextWidth = active.edge === 's' ? active.startW : active.startW + dx
    const nextHeight = active.edge === 'e' ? active.startH : active.startH + dy
    setSize(clampSize(nextWidth, nextHeight))
  }, [])

  const onResizePointerDown = useCallback((edge: ResizeEdge, event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.matchMedia('(max-width: 720px)').matches) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    userResized.current = true
    resize.current = {
      edge,
      startX: event.clientX,
      startY: event.clientY,
      startW: size.width,
      startH: size.height,
    }
    latest.current = { x: event.clientX, y: event.clientY }
    setResizing(true)
  }, [size.height, size.width])

  const onResizePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || !resize.current) return
    latest.current = { x: event.clientX, y: event.clientY }
    frame.current ??= requestAnimationFrame(applyResize)
  }, [applyResize])

  const onResizePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    applyResize()
    resize.current = null
    setResizing(false)
  }, [applyResize])

  if (!open) return null

  return (
    <WorkflowLeaveGuardProvider t={t}>
      <div
        className="dshWorkflowOverlay"
        role="dialog"
        aria-modal="true"
        aria-label={t('title')}
        data-resizing={resizing || undefined}
      >
        <button
          className="dshWorkflowOverlayMask"
          type="button"
          aria-label={t('close')}
          onClick={closePanel}
        />
        <section
          ref={panel}
          className="dshWorkflowOverlayPanel"
          style={{ width: size.width, height: size.height }}
        >
          <header className="dshWorkflowOverlayHeader">
            <div>
              <h1>{t('title')}</h1>
              <p>{t('subtitle')}</p>
            </div>
            <Tooltip label={t('close')}>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('close')}
                icon={<IconCloseOutline16 />}
                onClick={closePanel}
              />
            </Tooltip>
          </header>
          <div className="dshWorkflowOverlayBody">
            <WorkflowPanel
              api={api}
              t={t}
              useStore={useStore}
              actions={actions}
              showHeader={false}
              {...(sessionCwd ? { sessionCwd } : {})}
            />
          </div>
          <div
            className="dshWorkflowOverlayResize dshWorkflowOverlayResize-e"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('resizePanel')}
            onPointerDown={(event) => { onResizePointerDown('e', event) }}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
          />
          <div
            className="dshWorkflowOverlayResize dshWorkflowOverlayResize-s"
            role="separator"
            aria-orientation="horizontal"
            aria-label={t('resizePanel')}
            onPointerDown={(event) => { onResizePointerDown('s', event) }}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
          />
          <div
            className="dshWorkflowOverlayResize dshWorkflowOverlayResize-se"
            role="separator"
            aria-label={t('resizePanel')}
            onPointerDown={(event) => { onResizePointerDown('se', event) }}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
          />
        </section>
      </div>
    </WorkflowLeaveGuardProvider>
  )
}
