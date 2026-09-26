import { useEffect, useState } from 'react'
import {
  Button,
  IconCloseOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createTimeMasterStore } from './time-master-store.js'
import type {
  CoordSnapshotView,
  DesktopTimeMasterApi,
  TimeMasterPlanView,
  TimeMasterProjectView,
} from './time-master-api.js'
import type {
  CoordSuggestion,
  ProjectPlanDraft,
  ProjectPlanStatus,
  ProjectTaskDraft,
  ProjectTaskStatus,
  TokenPlanCycle,
  TokenPlanDraft,
  UsageSchedule,
  UsageScheduleDraft,
} from '../time-master/types.js'
import { DEFAULT_REMIND_DAYS } from '../time-master/types.js'
import { DESKTOP_COLLAB_PATH } from './collab-api.js'
import { DEFAULT_COLLAB_ACTOR_JID } from './collab-api.js'

export type TimeMasterOverlayProps = PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createTimeMasterStore>>
  & PropsLocale<'dsh-plugin-desktop/time-master'>
  & {
    api: DesktopTimeMasterApi
  }

type TabId = 'plans' | 'schedules' | 'projects' | 'coord'

interface PlanFormState {
  id?: string
  name: string
  providerHint: string
  cycle: TokenPlanCycle
  startsAt: string
  expiresAt: string
  remindDays: string
  notes: string
}

interface ScheduleFormState {
  id?: string
  name: string
  horizonDays: string
  rationale: string
  itemsJson: string
}

interface ProjectFormState {
  id?: string
  title: string
  goal: string
  status: ProjectPlanStatus
  tasksJson: string
}

function emptyPlanForm(): PlanFormState {
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

function emptyScheduleForm(): ScheduleFormState {
  return {
    name: '',
    horizonDays: '30',
    rationale: '',
    itemsJson: '[]',
  }
}

function emptyProjectForm(): ProjectFormState {
  return {
    title: '',
    goal: '',
    status: 'active',
    tasksJson: '[]',
  }
}

function planToForm(plan: TimeMasterPlanView): PlanFormState {
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

function draftToPlanForm(draft: TokenPlanDraft, id?: string): PlanFormState {
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

function formToPlanDraft(form: PlanFormState): TokenPlanDraft & { id?: string } {
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

function scheduleToForm(schedule: UsageSchedule): ScheduleFormState {
  return {
    id: schedule.id,
    name: schedule.name,
    horizonDays: String(schedule.horizonDays),
    rationale: schedule.rationale ?? '',
    itemsJson: JSON.stringify(schedule.items, null, 2),
  }
}

function draftToScheduleForm(draft: UsageScheduleDraft, id?: string): ScheduleFormState {
  return {
    ...(id ? { id } : {}),
    name: draft.name ?? '',
    horizonDays: String(draft.horizonDays ?? 30),
    rationale: draft.rationale ?? '',
    itemsJson: JSON.stringify(draft.items ?? [], null, 2),
  }
}

function formToScheduleDraft(form: ScheduleFormState): UsageScheduleDraft & { id?: string } {
  let items: UsageScheduleDraft['items'] = []
  try {
    const parsed = JSON.parse(form.itemsJson) as unknown
    if (Array.isArray(parsed)) items = parsed as UsageScheduleDraft['items']
  } catch {
    items = []
  }
  return {
    ...(form.id ? { id: form.id } : {}),
    name: form.name,
    horizonDays: Number(form.horizonDays) || 30,
    items,
    ...(form.rationale.trim() ? { rationale: form.rationale.trim() } : {}),
  }
}

function projectToForm(project: TimeMasterProjectView): ProjectFormState {
  return {
    id: project.id,
    title: project.title,
    goal: project.goal,
    status: project.status,
    tasksJson: JSON.stringify(project.tasks, null, 2),
  }
}

function draftToProjectForm(draft: ProjectPlanDraft, id?: string): ProjectFormState {
  return {
    ...(id ? { id } : {}),
    title: draft.title ?? '',
    goal: draft.goal ?? '',
    status: draft.status ?? 'active',
    tasksJson: JSON.stringify(draft.tasks ?? [], null, 2),
  }
}

function formToProjectDraft(form: ProjectFormState): ProjectPlanDraft & { id?: string } {
  let tasks: ProjectTaskDraft[] = []
  try {
    const parsed = JSON.parse(form.tasksJson) as unknown
    if (Array.isArray(parsed)) tasks = parsed as ProjectTaskDraft[]
  } catch {
    tasks = []
  }
  return {
    ...(form.id ? { id: form.id } : {}),
    title: form.title,
    goal: form.goal,
    status: form.status,
    tasks,
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

async function probeCollabAvailable(): Promise<boolean> {
  try {
    const response = await fetch(DESKTOP_COLLAB_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'loop.get', loopId: '__probe__' }),
    })
    return response.status !== 404
  } catch {
    return false
  }
}

/**
 * Centered overlay: tabbed plans / schedules / projects / coordination.
 */
export function TimeMasterOverlay({
  useStore,
  actions,
  api,
  t,
}: TimeMasterOverlayProps) {
  const open = useStore(state => state.panelOpen)
  const [tab, setTab] = useState<TabId>('plans')
  const [plans, setPlans] = useState<TimeMasterPlanView[]>([])
  const [schedules, setSchedules] = useState<UsageSchedule[]>([])
  const [projects, setProjects] = useState<TimeMasterProjectView[]>([])
  const [coordSnapshot, setCoordSnapshot] = useState<CoordSnapshotView | null>(null)
  const [suggestions, setSuggestions] = useState<CoordSuggestion[]>([])
  const [today, setToday] = useState('')
  const [planForm, setPlanForm] = useState<PlanFormState>(emptyPlanForm)
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>(emptyScheduleForm)
  const [projectForm, setProjectForm] = useState<ProjectFormState>(emptyProjectForm)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [aiHint, setAiHint] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [collabAvailable, setCollabAvailable] = useState(false)
  const [collabStarting, setCollabStarting] = useState(false)

  const reload = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.list()
      setPlans(result.plans)
      setSchedules(result.schedules)
      setProjects(result.projects)
      setToday(result.today)
      if (tab === 'coord') {
        const coord = await api.coordSnapshot()
        setCoordSnapshot(coord.snapshot)
      }
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
    void probeCollabAvailable().then(setCollabAvailable)
  }, [open])

  useEffect(() => {
    if (!open || tab !== 'coord') return
    void api.coordSnapshot()
      .then(result => setCoordSnapshot(result.snapshot))
      .catch(() => setCoordSnapshot(null))
  }, [open, tab])

  if (!open) return null

  const clearStatus = (): void => {
    setStatus(null)
    setError(null)
  }

  const saveCurrent = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      if (tab === 'plans') {
        const result = await api.upsert(formToPlanDraft(planForm))
        setPlanForm(planToForm({ ...result.plan, urgency: result.urgency }))
      } else if (tab === 'schedules') {
        const result = await api.scheduleUpsert(formToScheduleDraft(scheduleForm))
        setScheduleForm(scheduleToForm(result.schedule))
      } else if (tab === 'projects') {
        const result = await api.projectUpsert(formToProjectDraft(projectForm))
        setProjectForm(projectToForm({ ...result.project, tasks: result.project.tasks.map(task => ({
          ...task,
          urgency: 'none' as const,
        })) }))
      }
      setStatus(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setSaving(false)
    }
  }

  const deleteCurrent = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      if (tab === 'plans' && planForm.id) {
        await api.delete(planForm.id)
        setPlanForm(emptyPlanForm())
      } else if (tab === 'schedules' && scheduleForm.id) {
        await api.scheduleDelete(scheduleForm.id)
        setScheduleForm(emptyScheduleForm())
      } else if (tab === 'projects' && projectForm.id) {
        await api.projectDelete(projectForm.id)
        setProjectForm(emptyProjectForm())
      }
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
      if (tab === 'plans') {
        const result = await api.aiSuggest(aiHint)
        setPlanForm(draftToPlanForm(result.draft, planForm.id))
        setStatus(result.source === 'ai' ? t('aiSourceAi') : t('aiSourceHeuristic'))
      } else if (tab === 'schedules') {
        const result = await api.aiOrchestrateUsage(aiHint)
        setScheduleForm(draftToScheduleForm(result.draft, scheduleForm.id))
        setStatus(result.source === 'ai' ? t('aiSourceAi') : t('aiSourceHeuristic'))
      } else if (tab === 'projects') {
        const result = await api.aiPlanProject(aiHint)
        setProjectForm(draftToProjectForm(result.draft, projectForm.id))
        setStatus(result.source === 'ai' ? t('aiSourceAi') : t('aiSourceHeuristic'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setSuggesting(false)
    }
  }

  const analyzeCoord = async (): Promise<void> => {
    if (suggesting) return
    setSuggesting(true)
    setError(null)
    try {
      const result = await api.aiCoordinate()
      setSuggestions(result.suggestions)
      setCoordSnapshot(result.snapshot)
      setStatus(result.source === 'ai' ? t('aiSourceAi') : t('aiSourceHeuristic'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setSuggesting(false)
    }
  }

  const applyCoord = async (): Promise<void> => {
    if (suggesting) return
    setSuggesting(true)
    setError(null)
    try {
      const result = await api.aiCoordinate({ apply: true })
      setSuggestions(result.suggestions)
      setCoordSnapshot(result.snapshot)
      setStatus(t('coordApplied'))
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setSuggesting(false)
    }
  }

  const openCollab = async (): Promise<void> => {
    if (collabStarting) return
    setCollabStarting(true)
    setError(null)
    try {
      const goal = tab === 'projects' ? projectForm.goal : aiHint
      await fetch(DESKTOP_COLLAB_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          op: 'loop.start',
          workflowName: 'problem-loop',
          actorJid: DEFAULT_COLLAB_ACTOR_JID,
          ...(goal?.trim() ? { hint: goal.trim() } : {}),
        }),
      })
      setStatus(t('collabHandoff'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setCollabStarting(false)
    }
  }

  const currentId = tab === 'plans' ? planForm.id : tab === 'schedules' ? scheduleForm.id : tab === 'projects' ? projectForm.id : undefined
  const aiLabel = tab === 'schedules' ? t('aiOrchestrate') : tab === 'projects' ? t('aiPlanProject') : t('aiFill')
  const aiBusyLabel = tab === 'schedules' ? t('aiOrchestrating') : tab === 'projects' ? t('aiPlanning') : t('aiFilling')

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

        <nav className="dshTimeMasterTabs" role="tablist">
          {(['plans', 'schedules', 'projects', 'coord'] as const).map(tabId => (
            <button
              key={tabId}
              type="button"
              role="tab"
              aria-selected={tab === tabId}
              className="dshTimeMasterTab"
              data-active={tab === tabId || undefined}
              onClick={() => { setTab(tabId); clearStatus() }}
            >
              {tabId === 'plans' ? t('tabPlans')
                : tabId === 'schedules' ? t('tabSchedules')
                  : tabId === 'projects' ? t('tabProjects')
                    : t('tabCoord')}
            </button>
          ))}
        </nav>

        <p className="dshTimeMasterHint">{t('hint')}{today ? ` · ${today}` : ''}</p>

        {tab !== 'coord' && (
          <div className="dshTimeMasterToolbar">
            <input
              value={aiHint}
              placeholder={t('aiHintPlaceholder')}
              onChange={event => setAiHint(event.target.value)}
            />
            <Button variant="ghost" disabled={suggesting} onClick={() => void aiFill()}>
              {suggesting ? aiBusyLabel : aiLabel}
            </Button>
            <Button variant="ghost" disabled={loading} onClick={() => void reload()}>
              {t('refresh')}
            </Button>
            {tab === 'plans' && (
              <Button variant="primary" onClick={() => { setPlanForm(emptyPlanForm()); clearStatus() }}>
                {t('newPlan')}
              </Button>
            )}
            {tab === 'schedules' && (
              <Button variant="primary" onClick={() => { setScheduleForm(emptyScheduleForm()); clearStatus() }}>
                {t('newSchedule')}
              </Button>
            )}
            {tab === 'projects' && (
              <Button variant="primary" onClick={() => { setProjectForm(emptyProjectForm()); clearStatus() }}>
                {t('newProject')}
              </Button>
            )}
            {collabAvailable && tab === 'projects' && (
              <Button variant="ghost" disabled={collabStarting} onClick={() => void openCollab()}>
                {collabStarting ? t('collabStarting') : t('collabHandoff')}
              </Button>
            )}
          </div>
        )}

        <div className="dshTimeMasterBody">
          {tab === 'plans' && (
            <>
              <div className="dshTimeMasterList">
                {loading && <div className="dshTimeMasterEmpty">{t('loading')}</div>}
                {!loading && plans.length === 0 && (
                  <div className="dshTimeMasterEmpty">{t('empty')}</div>
                )}
                {!loading && plans.map(plan => (
                  <button
                    key={plan.id}
                    type="button"
                    className="dshTimeMasterRow"
                    data-urgency={plan.urgency}
                    data-active={planForm.id === plan.id || undefined}
                    onClick={() => { setPlanForm(planToForm(plan)); clearStatus() }}
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
                <div className="dshTimeMasterFormFields">
                  <h3>{planForm.id ? t('editPlan') : t('newPlan')}</h3>
                  <label className="dshTimeMasterField">
                    {t('fieldName')}
                    <input value={planForm.name} onChange={e => setPlanForm(f => ({ ...f, name: e.target.value }))} />
                  </label>
                  <label className="dshTimeMasterField">
                    {t('fieldProvider')}
                    <input value={planForm.providerHint} onChange={e => setPlanForm(f => ({ ...f, providerHint: e.target.value }))} />
                  </label>
                  <div className="dshTimeMasterFieldRow">
                    <label className="dshTimeMasterField">
                      {t('fieldCycle')}
                      <select value={planForm.cycle} onChange={e => setPlanForm(f => ({ ...f, cycle: e.target.value as TokenPlanCycle }))}>
                        <option value="monthly">{t('cycleMonthly')}</option>
                        <option value="yearly">{t('cycleYearly')}</option>
                        <option value="custom">{t('cycleCustom')}</option>
                      </select>
                    </label>
                    <label className="dshTimeMasterField">
                      {t('fieldRemindDays')}
                      <input value={planForm.remindDays} onChange={e => setPlanForm(f => ({ ...f, remindDays: e.target.value }))} />
                    </label>
                  </div>
                  <div className="dshTimeMasterFieldRow">
                    <label className="dshTimeMasterField">
                      {t('fieldStartsAt')}
                      <input type="date" value={planForm.startsAt} onChange={e => setPlanForm(f => ({ ...f, startsAt: e.target.value }))} />
                    </label>
                    <label className="dshTimeMasterField">
                      {t('fieldExpiresAt')}
                      <input type="date" value={planForm.expiresAt} onChange={e => setPlanForm(f => ({ ...f, expiresAt: e.target.value }))} />
                    </label>
                  </div>
                  <label className="dshTimeMasterField">
                    {t('fieldNotes')}
                    <textarea value={planForm.notes} onChange={e => setPlanForm(f => ({ ...f, notes: e.target.value }))} />
                  </label>
                </div>
              </div>
            </>
          )}

          {tab === 'schedules' && (
            <>
              <div className="dshTimeMasterList">
                {loading && <div className="dshTimeMasterEmpty">{t('loading')}</div>}
                {!loading && schedules.length === 0 && (
                  <div className="dshTimeMasterEmpty">{t('schedulesEmpty')}</div>
                )}
                {!loading && schedules.map(schedule => (
                  <button
                    key={schedule.id}
                    type="button"
                    className="dshTimeMasterRow"
                    data-active={scheduleForm.id === schedule.id || undefined}
                    onClick={() => { setScheduleForm(scheduleToForm(schedule)); clearStatus() }}
                  >
                    <span className="dshTimeMasterRowTitle">{schedule.name}</span>
                    <span className="dshTimeMasterRowMeta">
                      {schedule.items.length} items · {schedule.horizonDays}d
                    </span>
                  </button>
                ))}
              </div>
              <div className="dshTimeMasterForm">
                <div className="dshTimeMasterFormFields">
                  <h3>{scheduleForm.id ? t('editSchedule') : t('newSchedule')}</h3>
                  <label className="dshTimeMasterField">
                    {t('fieldScheduleName')}
                    <input value={scheduleForm.name} onChange={e => setScheduleForm(f => ({ ...f, name: e.target.value }))} />
                  </label>
                  <label className="dshTimeMasterField">
                    {t('fieldHorizonDays')}
                    <input value={scheduleForm.horizonDays} onChange={e => setScheduleForm(f => ({ ...f, horizonDays: e.target.value }))} />
                  </label>
                  <label className="dshTimeMasterField">
                    {t('fieldRationale')}
                    <textarea value={scheduleForm.rationale} onChange={e => setScheduleForm(f => ({ ...f, rationale: e.target.value }))} />
                  </label>
                  <label className="dshTimeMasterField">
                    {t('fieldScheduleItems')}
                    <textarea
                      className="dshTimeMasterJsonArea"
                      value={scheduleForm.itemsJson}
                      onChange={e => setScheduleForm(f => ({ ...f, itemsJson: e.target.value }))}
                    />
                  </label>
                </div>
              </div>
            </>
          )}

          {tab === 'projects' && (
            <>
              <div className="dshTimeMasterList">
                {loading && <div className="dshTimeMasterEmpty">{t('loading')}</div>}
                {!loading && projects.length === 0 && (
                  <div className="dshTimeMasterEmpty">{t('projectsEmpty')}</div>
                )}
                {!loading && projects.map(project => (
                  <button
                    key={project.id}
                    type="button"
                    className="dshTimeMasterRow"
                    data-active={projectForm.id === project.id || undefined}
                    onClick={() => { setProjectForm(projectToForm(project)); clearStatus() }}
                  >
                    <span className="dshTimeMasterRowTitle">{project.title}</span>
                    <span className="dshTimeMasterRowMeta">
                      {project.tasks.length} tasks · {project.status}
                    </span>
                  </button>
                ))}
              </div>
              <div className="dshTimeMasterForm">
                <div className="dshTimeMasterFormFields">
                  <h3>{projectForm.id ? t('editProject') : t('newProject')}</h3>
                  <label className="dshTimeMasterField">
                    {t('fieldProjectTitle')}
                    <input value={projectForm.title} onChange={e => setProjectForm(f => ({ ...f, title: e.target.value }))} />
                  </label>
                  <label className="dshTimeMasterField">
                    {t('fieldProjectGoal')}
                    <textarea value={projectForm.goal} onChange={e => setProjectForm(f => ({ ...f, goal: e.target.value }))} />
                  </label>
                  <label className="dshTimeMasterField">
                    {t('fieldProjectStatus')}
                    <select
                      value={projectForm.status}
                      onChange={e => setProjectForm(f => ({ ...f, status: e.target.value as ProjectPlanStatus }))}
                    >
                      <option value="active">{t('statusActive')}</option>
                      <option value="paused">{t('statusPaused')}</option>
                      <option value="done">{t('statusDone')}</option>
                    </select>
                  </label>
                  <label className="dshTimeMasterField">
                    {t('fieldTasks')}
                    <textarea
                      className="dshTimeMasterJsonArea"
                      value={projectForm.tasksJson}
                      onChange={e => setProjectForm(f => ({ ...f, tasksJson: e.target.value }))}
                    />
                  </label>
                </div>
              </div>
            </>
          )}

          {tab === 'coord' && (
            <div className="dshTimeMasterCoordPane">
              <div className="dshTimeMasterCoordToolbar">
                <Button variant="ghost" disabled={suggesting} onClick={() => void analyzeCoord()}>
                  {suggesting ? t('coordAnalyzing') : t('coordAnalyze')}
                </Button>
                {suggestions.length > 0 && (
                  <Button variant="primary" disabled={suggesting} onClick={() => void applyCoord()}>
                    {t('coordApply')}
                  </Button>
                )}
                {collabAvailable && (
                  <Button variant="ghost" disabled={collabStarting} onClick={() => void openCollab()}>
                    {collabStarting ? t('collabStarting') : t('collabHandoff')}
                  </Button>
                )}
                <Button variant="ghost" disabled={loading} onClick={() => void reload()}>
                  {t('refresh')}
                </Button>
              </div>
              {!coordSnapshot?.conflicts.length && (
                <div className="dshTimeMasterEmpty">{t('coordEmpty')}</div>
              )}
              {coordSnapshot && coordSnapshot.conflicts.length > 0 && (
                <div className="dshTimeMasterCoordList">
                  <h3>{t('coordConflicts')}</h3>
                  {coordSnapshot.conflicts.map((conflict, index) => (
                    <div key={`${conflict.code}-${index}`} className="dshTimeMasterCoordItem">
                      <strong>{conflict.code}</strong>
                      <span>{conflict.detail}</span>
                      <span className="dshTimeMasterRowMeta">{conflict.taskIds.join(', ')}</span>
                    </div>
                  ))}
                </div>
              )}
              {suggestions.length > 0 && (
                <pre className="dshTimeMasterJsonPreview">{JSON.stringify(suggestions, null, 2)}</pre>
              )}
            </div>
          )}

          {status && <div className="dshTimeMasterStatus dshTimeMasterStatusBar">{status}</div>}
          {error && <div className="dshTimeMasterError dshTimeMasterStatusBar">{error}</div>}
        </div>

        {tab !== 'coord' && (
          <div className="dshTimeMasterFormActions">
            <Button variant="primary" disabled={saving} onClick={() => void saveCurrent()}>
              {saving ? t('saving') : t('save')}
            </Button>
            {currentId && (
              <Button variant="ghost" disabled={saving} onClick={() => void deleteCurrent()}>
                {t('delete')}
              </Button>
            )}
            <Button variant="ghost" onClick={() => {
              if (tab === 'plans') setPlanForm(emptyPlanForm())
              else if (tab === 'schedules') setScheduleForm(emptyScheduleForm())
              else setProjectForm(emptyProjectForm())
              clearStatus()
            }}
            >
              {t('cancel')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
