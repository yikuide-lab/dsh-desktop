import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { WorkflowLocaleKey } from './locales-workflow.js'

export interface WorkflowLeaveGuardRegistration {
  /** True when the editor has unsaved changes (or a pending AI preview). */
  isDirty: () => boolean
  /** Persist the current draft. Returns false when save failed / was blocked. */
  save: () => Promise<boolean>
}

interface WorkflowLeaveGuardContextValue {
  register: (registration: WorkflowLeaveGuardRegistration | null) => void
  /** Ask to leave; resolves true when the caller may proceed (saved or discarded). */
  requestLeave: () => Promise<boolean>
}

const WorkflowLeaveGuardContext = createContext<WorkflowLeaveGuardContextValue | null>(null)

/** Module bridge so launchers outside the React tree can request a guarded close. */
let activeLeaveGuard: WorkflowLeaveGuardContextValue | null = null

/** Close the workflow surface only when leave is allowed (save / discard / clean). */
export async function requestWorkflowPanelClose(): Promise<boolean> {
  if (!activeLeaveGuard) return true
  return activeLeaveGuard.requestLeave()
}

interface WorkflowLeaveGuardProviderProps {
  t: (key: WorkflowLocaleKey) => string
  children: ReactNode
}

/**
 * Owns unsaved-design confirmation for overlay close, cancel, and app unload.
 */
export function WorkflowLeaveGuardProvider({ t, children }: WorkflowLeaveGuardProviderProps) {
  const registration = useRef<WorkflowLeaveGuardRegistration | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const waiter = useRef<((allowed: boolean) => void) | null>(null)

  const settle = useCallback((allowed: boolean) => {
    setPromptOpen(false)
    setBusy(false)
    const resolve = waiter.current
    waiter.current = null
    resolve?.(allowed)
  }, [])

  const requestLeave = useCallback((): Promise<boolean> => {
    if (waiter.current) {
      return new Promise((resolve) => {
        const previous = waiter.current
        waiter.current = (allowed) => {
          previous?.(allowed)
          resolve(allowed)
        }
      })
    }
    if (!registration.current?.isDirty()) {
      return Promise.resolve(true)
    }
    setPromptOpen(true)
    return new Promise((resolve) => {
      waiter.current = resolve
    })
  }, [])

  const register = useCallback((next: WorkflowLeaveGuardRegistration | null) => {
    registration.current = next
  }, [])

  const value = useMemo(
    () => ({ register, requestLeave }),
    [register, requestLeave],
  )

  useEffect(() => {
    activeLeaveGuard = value
    return () => {
      if (activeLeaveGuard === value) activeLeaveGuard = null
    }
  }, [value])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!registration.current?.isDirty()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const onSave = async (): Promise<void> => {
    if (!registration.current) {
      settle(true)
      return
    }
    setBusy(true)
    try {
      const ok = await registration.current.save()
      settle(ok)
    } catch {
      setBusy(false)
    }
  }

  return (
    <WorkflowLeaveGuardContext.Provider value={value}>
      {children}
      {promptOpen && (
        <div
          className="workflow-unsaved-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="workflow-unsaved-title"
          aria-describedby="workflow-unsaved-detail"
        >
          <div className="workflow-unsaved-dialog-card">
            <h3 id="workflow-unsaved-title">{t('unsavedTitle')}</h3>
            <p id="workflow-unsaved-detail">{t('unsavedDetail')}</p>
            <div className="workflow-unsaved-dialog-actions">
              <button
                type="button"
                className="workflow-btn primary"
                disabled={busy}
                onClick={() => void onSave()}
              >
                {busy ? t('loading') : t('unsavedSave')}
              </button>
              <button
                type="button"
                className="workflow-btn"
                disabled={busy}
                onClick={() => settle(true)}
              >
                {t('unsavedDiscard')}
              </button>
              <button
                type="button"
                className="workflow-btn"
                disabled={busy}
                onClick={() => settle(false)}
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </WorkflowLeaveGuardContext.Provider>
  )
}

/** Register the active editor as the leave-guard target for the provider lifetime. */
export function useWorkflowLeaveGuard(
  enabled: boolean,
  isDirty: () => boolean,
  save: () => Promise<boolean>,
): void {
  const ctx = useContext(WorkflowLeaveGuardContext)
  const isDirtyRef = useRef(isDirty)
  const saveRef = useRef(save)
  isDirtyRef.current = isDirty
  saveRef.current = save

  useEffect(() => {
    if (!ctx || !enabled) {
      ctx?.register(null)
      return
    }
    ctx.register({
      isDirty: () => isDirtyRef.current(),
      save: () => saveRef.current(),
    })
    return () => ctx.register(null)
  }, [ctx, enabled])
}

/** Request leave from inside the React tree (editor cancel, etc.). */
export function useWorkflowRequestLeave(): () => Promise<boolean> {
  const ctx = useContext(WorkflowLeaveGuardContext)
  return useCallback(async () => {
    if (!ctx) return true
    return ctx.requestLeave()
  }, [ctx])
}
