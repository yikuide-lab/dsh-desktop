import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { RUN_RESIZE_STEP_PX } from './workflow-run-layout.js'

interface RunResizeHandleProps {
  label: string
  /** Current width of the column this handle resizes (for aria-valuenow). */
  value: number
  onStart: () => void
  /** Cumulative px delta from drag start (mirrors `AdvancedFrame`'s ResizeHandle). */
  onDrag: (delta: number) => void
  onEnd: () => void
  /** Keyboard resize; receives a signed px delta. */
  onNudge: (deltaPx: number) => void
}

/**
 * Vertical splitter between the run-record panes. Dragging right always widens
 * the column to the handle's right, so `onDrag`/`onNudge` share one sign.
 */
export function RunResizeHandle({
  label,
  value,
  onStart,
  onDrag,
  onEnd,
  onNudge,
}: RunResizeHandleProps) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onStart, onDrag, onEnd, onNudge })
  callbacks.current = { onStart, onDrag, onEnd, onNudge }

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    origin.current = event.clientX
    latest.current = event.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    latest.current = event.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])

  const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      callbacks.current.onNudge(RUN_RESIZE_STEP_PX)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      callbacks.current.onNudge(-RUN_RESIZE_STEP_PX)
    }
  }, [])

  return (
    <div
      className="workflow-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
    />
  )
}
