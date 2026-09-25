import { useEffect, useState } from 'react'
import {
  Button,
  IconCloseOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createTimeMasterStore } from './time-master-store.js'
import type { DesktopTimeMasterApi, TimeMasterPlanView } from './time-master-api.js'
import type { TokenPlanCycle, TokenPlanDraft } from '../time-master/types.js'
import { DEFAULT_REMIND_DAYS } from '../time-master/types.js'

export type TimeMasterOverlayProps = PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createTimeMasterStore>>
  & PropsLocale<'dsh-plugin-desktop/time-master'>
  & {
    api: DesktopTimeMasterApi
  }

interface FormState {
  id?: string
  name: string
  providerHint: string
  cycle: TokenPlanCycle
  startsAt: string
  expiresAt: string
  remindDays: string
  notes: string
}

function emptyForm(): FormState {
  return {
    name: '',
    providerHint: '',
    cycle: 'monthly',
    startsAt: '',
    expiresAt: '',
    remindDays: DEFAULT_REMIND_DAYS.join(', '),
    notes: '',
  }
}

function planToForm(plan: TimeMasterPlanView): FormState {
  return {
    id: plan.id,
    name: plan.name,
    providerHint: plan.providerHint ?? '',
    cycle: plan.cycle,
    startsAt: plan.startsAt ?? '',
    expiresAt: plan.expiresAt,
    remindDays: plan.remindDays.join(', '),
    notes: plan.notes ?? '',
  }
}

function draftToForm(draft: TokenPlanDraft, id?: string): FormState {
  return {
    ...(id ? { id } : {}),
    name: draft.name ?? '',
    providerHint: draft.providerHint ?? '',
    cycle: draft.cycle ?? 'monthly',
    startsAt: draft.startsAt ?? '',
    expiresAt: draft.expiresAt ?? '',
    remindDays: (draft.remindDays ?? DEFAULT_REMIND_DAYS).join(', '),
    notes: draft.notes ?? '',
  }
}

function formToDraft(form: FormState): TokenPlanDraft & { id?: string } {
  const remindDays = form.remindDays
    .split(/[,，\s]+/)
    .map(part => Number(part.trim()))
    .filter(day => Number.isFinite(day) && day >= 0)
  return {
    ...(form.id ? { id: form.id } : {}),
    name: form.name,
    ...(form.providerHint.trim() ? { providerHint: form.providerHint.trim() } : {}),
    cycle: form.cycle,
    ...(form.startsAt.trim() ? { startsAt: form.startsAt.trim() } : {}),
    expiresAt: form.expiresAt,
    remindDays: remindDays.length > 0 ? remindDays : [...DEFAULT_REMIND_DAYS],
    ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
  }
}

function urgencyLabel(
  urgency: TimeMasterPlanView['urgency'],
  t: TimeMasterOverlayProps['t'],
): string {
  if (urgency === 'expired') return t('urgencyExpired')
  if (urgency === 'soon') return t('urgencySoon')
  return t('urgencyOk')
}

/**
 * Centered overlay: plan list, inline edit form, and AI-assisted draft fill.
 */
export function TimeMasterOverlay({
  useStore,
  actions,
  api,
  t,
}: TimeMasterOverlayProps) {
  const open = useStore(state => state.panelOpen)
  const [plans, setPlans] = useState<TimeMasterPlanView[]>([])
  const [today, setToday] = useState('')
  const [form, setForm] = useState<FormState>(emptyForm)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [aiHint, setAiHint] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const reload = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.list()
      setPlans(result.plans)
      setToday(result.today)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') actions.setPanelOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, actions])

  useEffect(() => {
    if (!open) return
    void reload()
  }, [open])

  if (!open) return null

  const patchForm = (patch: Partial<FormState>): void => {
    setForm(current => ({ ...current, ...patch }))
  }

  const startNew = (): void => {
    setForm(emptyForm())
    setStatus(null)
    setError(null)
  }

  const save = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const result = await api.upsert(formToDraft(form))
      setStatus(null)
      setForm(planToForm({ ...result.plan, urgency: result.urgency }))
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!form.id || saving) return
    setSaving(true)
    setError(null)
    try {
      await api.delete(form.id)
      setForm(emptyForm())
      setStatus(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setSaving(false)
    }
  }

  const aiFill = async (): Promise<void> => {
    if (suggesting) return
    setSuggesting(true)
    setError(null)
    try {
      const result = await api.aiSuggest(aiHint)
      setForm(draftToForm(result.draft, form.id))
      setStatus(result.source === 'ai' ? t('aiSourceAi') : t('aiSourceHeuristic'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setSuggesting(false)
    }
  }

  return (
    <div className="dshTimeMasterOverlay" role="presentation">
      <div
        className="dshTimeMasterDialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('title')}
      >
        <header className="dshTimeMasterHeader">
          <h2 className="dshTimeMasterTitle">{t('title')}</h2>
          <Button
            variant="ghost"
            aria-label={t('close')}
            icon={<IconCloseOutline16 />}
            onClick={() => actions.setPanelOpen(false)}
          />
        </header>

        <p className="dshTimeMasterHint">{t('hint')}{today ? ` · ${today}` : ''}</p>

        <div className="dshTimeMasterToolbar">
          <input
            value={aiHint}
            placeholder={t('aiHintPlaceholder')}
            onChange={event => setAiHint(event.target.value)}
          />
          <Button variant="ghost" disabled={suggesting} onClick={() => void aiFill()}>
            {suggesting ? t('aiFilling') : t('aiFill')}
          </Button>
          <Button variant="ghost" disabled={loading} onClick={() => void reload()}>
            {t('refresh')}
          </Button>
          <Button variant="primary" onClick={startNew}>{t('newPlan')}</Button>
        </div>

        <div className="dshTimeMasterBody">
          <div className="dshTimeMasterList">
            {loading && <div className="dshTimeMasterEmpty">{t('loading')}</div>}
            {!loading && error !== null && plans.length === 0 && (
              <div className="dshTimeMasterError">{error}</div>
            )}
            {!loading && plans.length === 0 && error === null && (
              <div className="dshTimeMasterEmpty">{t('empty')}</div>
            )}
            {!loading && plans.map(plan => (
              <button
                key={plan.id}
                type="button"
                className="dshTimeMasterRow"
                data-urgency={plan.urgency}
                data-active={form.id === plan.id || undefined}
                onClick={() => {
                  setForm(planToForm(plan))
                  setStatus(null)
                  setError(null)
                }}
              >
                <span className="dshTimeMasterRowTitle">{plan.name}</span>
                <span className="dshTimeMasterRowMeta">
                  {plan.expiresAt}
                  {plan.providerHint ? ` · ${plan.providerHint}` : ''}
                  {` · ${plan.cycle}`}
                </span>
                <span className="dshTimeMasterBadge" data-urgency={plan.urgency}>
                  {urgencyLabel(plan.urgency, t)}
                </span>
              </button>
            ))}
          </div>

          <div className="dshTimeMasterForm">
            <h3>{form.id ? t('editPlan') : t('newPlan')}</h3>
            <label className="dshTimeMasterField">
              {t('fieldName')}
              <input value={form.name} onChange={event => patchForm({ name: event.target.value })} />
            </label>
            <label className="dshTimeMasterField">
              {t('fieldProvider')}
              <input
                value={form.providerHint}
                onChange={event => patchForm({ providerHint: event.target.value })}
              />
            </label>
            <label className="dshTimeMasterField">
              {t('fieldCycle')}
              <select
                value={form.cycle}
                onChange={event => patchForm({ cycle: event.target.value as TokenPlanCycle })}
              >
                <option value="monthly">{t('cycleMonthly')}</option>
                <option value="yearly">{t('cycleYearly')}</option>
                <option value="custom">{t('cycleCustom')}</option>
              </select>
            </label>
            <label className="dshTimeMasterField">
              {t('fieldStartsAt')}
              <input
                type="date"
                value={form.startsAt}
                onChange={event => patchForm({ startsAt: event.target.value })}
              />
            </label>
            <label className="dshTimeMasterField">
              {t('fieldExpiresAt')}
              <input
                type="date"
                value={form.expiresAt}
                onChange={event => patchForm({ expiresAt: event.target.value })}
              />
            </label>
            <label className="dshTimeMasterField">
              {t('fieldRemindDays')}
              <input
                value={form.remindDays}
                onChange={event => patchForm({ remindDays: event.target.value })}
              />
            </label>
            <label className="dshTimeMasterField">
              {t('fieldNotes')}
              <textarea
                value={form.notes}
                onChange={event => patchForm({ notes: event.target.value })}
              />
            </label>
            {status && <div className="dshTimeMasterStatus">{status}</div>}
            {error && <div className="dshTimeMasterError">{error}</div>}
            <div className="dshTimeMasterFormActions">
              <Button variant="primary" disabled={saving} onClick={() => void save()}>
                {saving ? t('saving') : t('save')}
              </Button>
              {form.id && (
                <Button variant="ghost" disabled={saving} onClick={() => void remove()}>
                  {t('delete')}
                </Button>
              )}
              <Button variant="ghost" onClick={startNew}>{t('cancel')}</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
