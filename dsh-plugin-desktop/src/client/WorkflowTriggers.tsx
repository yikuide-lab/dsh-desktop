import { useCallback, useEffect, useState } from 'react'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import { requestYamlFields } from './workflow-ai-yaml.js'
import type {
  DesktopWorkflowApi,
  WorkflowTriggerConfigView,
  WorkflowTriggerType,
  WorkflowTriggerView,
} from './desktop-workflow-api.js'

interface WorkflowTriggersProps {
  api: DesktopWorkflowApi
  t: (key: WorkflowLocaleKey) => string
}

function emptyForm(): {
  type: WorkflowTriggerType
  workflowName: string
  schedule: string
  source: string
  on: string
  filter: string
  paramsJson: string
} {
  return {
    type: 'cron',
    workflowName: '',
    schedule: '0 * * * *',
    source: '',
    on: '',
    filter: '',
    paramsJson: '',
  }
}

function triggerDetail(trigger: WorkflowTriggerView): string {
  const { config } = trigger
  if (config.type === 'cron') return config.schedule ?? '-'
  if (config.type === 'event') {
    return [config.source, config.on].filter(Boolean).join(' / ') || '-'
  }
  return 'manual'
}

function isTriggersDisabledError(message: string): boolean {
  return /triggers are disabled/i.test(message)
}

/** Manage cron / event / manual workflow triggers and fire test events. */
export function WorkflowTriggers({ api, t }: WorkflowTriggersProps) {
  const [triggers, setTriggers] = useState<WorkflowTriggerView[]>([])
  const [form, setForm] = useState(emptyForm)
  const [fireSource, setFireSource] = useState('')
  const [fireName, setFireName] = useState('')
  const [fireDataJson, setFireDataJson] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [disabledHint, setDisabledHint] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiBusy, setAiBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await api.listTriggers()
      setTriggers(list)
      setDisabledHint(false)
    } catch (err) {
      const text = err instanceof Error ? err.message : t('error')
      setError(text)
      if (isTriggersDisabledError(text)) setDisabledHint(true)
    } finally {
      setLoading(false)
    }
  }, [api, t])

  useEffect(() => {
    void load()
  }, [load])

  /** Fill the trigger form from a natural-language schedule description. */
  const handleAiFill = async (): Promise<void> => {
    setError(null)
    setMessage(null)
    setAiBusy(true)
    try {
      const fields = await requestYamlFields(api, {
        system: [
          'You fill a workflow trigger form. Reply with ONLY a fenced flat YAML document:',
          '```yaml',
          'type: cron | event | manual',
          'workflowName: <workflow to trigger>',
          'schedule: <5-field cron expression; only when type is cron>',
          'source: <event source; only when type is event>',
          'on: <event name; only when type is event>',
          'filter: <optional filter such as data.status=ok>',
          '```',
          'One scalar per key. Keys and enum values stay exactly as above.',
        ].join('\n'),
        prompt: aiPrompt.trim(),
        maxTokens: 400,
      })
      if (fields === null) {
        setError(t('aiGeneratedFailed'))
        return
      }
      const rawType = fields.type
      setForm((prev) => ({
        type: rawType === 'event' || rawType === 'manual' ? rawType : 'cron',
        workflowName: fields.workflowName ?? prev.workflowName,
        schedule: fields.schedule ?? prev.schedule,
        source: fields.source ?? prev.source,
        on: fields.on ?? prev.on,
        filter: fields.filter ?? prev.filter,
        paramsJson: prev.paramsJson,
      }))
      setMessage(t('aiFillForm'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiGeneratedFailed'))
    } finally {
      setAiBusy(false)
    }
  }

  const handleAdd = async (): Promise<void> => {
    setError(null)
    setMessage(null)
    if (!form.workflowName.trim()) {
      setError(t('triggerWorkflowRequired'))
      return
    }
    let params: Record<string, unknown> | undefined
    if (form.paramsJson.trim()) {
      try {
        const parsed = JSON.parse(form.paramsJson) as unknown
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('params must be a JSON object')
        }
        params = parsed as Record<string, unknown>
      } catch (err) {
        setError(err instanceof Error ? err.message : t('triggerParamsInvalid'))
        return
      }
    }
    const config: WorkflowTriggerConfigView = {
      type: form.type,
      workflowName: form.workflowName.trim(),
    }
    if (form.type === 'cron') {
      if (!form.schedule.trim()) {
        setError(t('triggerScheduleRequired'))
        return
      }
      config.schedule = form.schedule.trim()
    } else if (form.type === 'event') {
      if (!form.source.trim() || !form.on.trim()) {
        setError(t('triggerEventRequired'))
        return
      }
      config.source = form.source.trim()
      config.on = form.on.trim()
    }
    if (form.filter.trim()) config.filter = form.filter.trim()
    if (params) config.params = params

    setBusy(true)
    try {
      await api.addTrigger(config)
      setForm(emptyForm())
      setMessage(t('triggerAdded'))
      setDisabledHint(false)
      await load()
    } catch (err) {
      const text = err instanceof Error ? err.message : t('error')
      setError(text)
      if (isTriggersDisabledError(text)) setDisabledHint(true)
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (triggerId: string): Promise<void> => {
    if (!confirm(t('triggerConfirmRemove'))) return
    setError(null)
    setMessage(null)
    try {
      await api.removeTrigger(triggerId)
      setMessage(t('triggerRemoved'))
      await load()
    } catch (err) {
      const text = err instanceof Error ? err.message : t('error')
      setError(text)
      if (isTriggersDisabledError(text)) setDisabledHint(true)
    }
  }

  const handleToggle = async (trigger: WorkflowTriggerView): Promise<void> => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      if (trigger.enabled) await api.disableTrigger(trigger.id)
      else await api.enableTrigger(trigger.id)
      setMessage(trigger.enabled ? t('triggerDisabled') : t('triggerEnabled'))
      await load()
    } catch (err) {
      const text = err instanceof Error ? err.message : t('error')
      setError(text)
      if (isTriggersDisabledError(text)) setDisabledHint(true)
    } finally {
      setBusy(false)
    }
  }

  const handleFireManual = async (triggerId: string): Promise<void> => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await api.fireManualTrigger(triggerId)
      setMessage(t('triggerManualFired'))
      await load()
    } catch (err) {
      const text = err instanceof Error ? err.message : t('error')
      setError(text)
      if (isTriggersDisabledError(text)) setDisabledHint(true)
    } finally {
      setBusy(false)
    }
  }

  const handleFire = async (): Promise<void> => {
    setError(null)
    setMessage(null)
    if (!fireSource.trim() || !fireName.trim()) {
      setError(t('triggerFireRequired'))
      return
    }
    let data: Record<string, unknown> | undefined
    if (fireDataJson.trim()) {
      try {
        const parsed = JSON.parse(fireDataJson) as unknown
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('data must be a JSON object')
        }
        data = parsed as Record<string, unknown>
      } catch (err) {
        setError(err instanceof Error ? err.message : t('triggerDataInvalid'))
        return
      }
    }
    setBusy(true)
    try {
      await api.fireTriggerEvent(fireSource.trim(), fireName.trim(), data)
      setMessage(t('triggerFired'))
      setDisabledHint(false)
    } catch (err) {
      const text = err instanceof Error ? err.message : t('error')
      setError(text)
      if (isTriggersDisabledError(text)) setDisabledHint(true)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="workflow-loading">{t('loading')}</div>

  return (
    <div className="workflow-triggers">
      <div className="workflow-list-header">
        <h3>{t('triggersTitle')}</h3>
        <button type="button" className="workflow-btn small" onClick={() => void load()}>
          {t('refresh')}
        </button>
      </div>

      {disabledHint && <div className="workflow-error">{t('triggersDisabled')}</div>}
      {error && <div className="workflow-error">{error}</div>}
      {message && <div className="workflow-success">{message}</div>}

      {triggers.length === 0 ? (
        <div className="workflow-empty">
          <p>{t('triggersEmpty')}</p>
        </div>
      ) : (
        <div className="workflow-run-cards">
          {triggers.map((trigger) => (
            <div key={trigger.id} className="workflow-run-card">
              <div className="workflow-run-header">
                <span className="workflow-run-name">{trigger.config.workflowName}</span>
                <span className="workflow-run-status">
                  {trigger.enabled ? t('triggerEnabled') : t('triggerDisabled')}
                </span>
              </div>
              <div className="workflow-run-meta">
                <span>{trigger.id}</span>
                <span>{trigger.config.type}</span>
                <span>{triggerDetail(trigger)}</span>
                {trigger.config.filter ? <span>{trigger.config.filter}</span> : null}
                {trigger.nextTrigger ? (
                  <span>{t('triggerNext')}: {new Date(trigger.nextTrigger).toLocaleString()}</span>
                ) : null}
              </div>
              <div className="workflow-gate-actions" style={{ marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="workflow-btn small"
                  disabled={busy}
                  onClick={() => void handleToggle(trigger)}
                >
                  {trigger.enabled ? t('triggerDisable') : t('triggerEnable')}
                </button>
                {trigger.config.type === 'manual' && (
                  <button
                    type="button"
                    className="workflow-btn small primary"
                    disabled={busy || !trigger.enabled}
                    onClick={() => void handleFireManual(trigger.id)}
                  >
                    {t('triggerFireManual')}
                  </button>
                )}
                <button
                  type="button"
                  className="workflow-btn small danger"
                  disabled={busy}
                  onClick={() => void handleRemove(trigger.id)}
                >
                  {t('triggerRemove')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="workflow-settings" style={{ marginTop: '1.25rem' }}>
        <h4>{t('triggerAdd')}</h4>
        <div className="workflow-ai-inline">
          <p className="workflow-templates-hint" style={{ margin: 0 }}>{t('aiTriggerHint')}</p>
          <textarea
            value={aiPrompt}
            onChange={(event) => setAiPrompt(event.target.value)}
            placeholder={t('aiTriggerHint')}
          />
          <div className="workflow-settings-provider-actions" style={{ gap: 8 }}>
            <button
              type="button"
              className="workflow-btn small primary"
              disabled={aiBusy || !aiPrompt.trim()}
              onClick={() => { void handleAiFill() }}
            >
              {aiBusy ? t('aiDesignGenerating') : t('aiFillForm')}
            </button>
          </div>
        </div>
        <div className="workflow-settings-grid">
          <label className="workflow-settings-field">
            <span>{t('triggerType')}</span>
            <select
              value={form.type}
              onChange={(event) => {
                const value = event.target.value
                if (value === 'cron' || value === 'event' || value === 'manual') {
                  setForm({ ...form, type: value })
                }
              }}
            >
              <option value="cron">cron</option>
              <option value="event">event</option>
              <option value="manual">manual</option>
            </select>
          </label>
          <label className="workflow-settings-field">
            <span>{t('triggerWorkflow')}</span>
            <input
              value={form.workflowName}
              onChange={(event) => setForm({ ...form, workflowName: event.target.value })}
              placeholder="my-workflow"
            />
          </label>
          {form.type === 'cron' && (
            <label className="workflow-settings-field">
              <span>{t('triggerSchedule')}</span>
              <input
                value={form.schedule}
                onChange={(event) => setForm({ ...form, schedule: event.target.value })}
                placeholder="0 * * * *"
              />
            </label>
          )}
          {form.type === 'event' && (
            <>
              <label className="workflow-settings-field">
                <span>{t('triggerSource')}</span>
                <input
                  value={form.source}
                  onChange={(event) => setForm({ ...form, source: event.target.value })}
                />
              </label>
              <label className="workflow-settings-field">
                <span>{t('triggerOn')}</span>
                <input
                  value={form.on}
                  onChange={(event) => setForm({ ...form, on: event.target.value })}
                />
              </label>
            </>
          )}
          <label className="workflow-settings-field">
            <span>{t('triggerFilter')}</span>
            <input
              value={form.filter}
              onChange={(event) => setForm({ ...form, filter: event.target.value })}
              placeholder="data.status=ok"
            />
          </label>
          <label className="workflow-settings-field">
            <span>{t('triggerParams')}</span>
            <textarea
              rows={3}
              value={form.paramsJson}
              onChange={(event) => setForm({ ...form, paramsJson: event.target.value })}
              placeholder='{"key":"value"}'
            />
          </label>
        </div>
        <button
          type="button"
          className="workflow-btn primary"
          disabled={busy}
          onClick={() => { void handleAdd() }}
        >
          {t('triggerAdd')}
        </button>
      </div>

      <div className="workflow-settings" style={{ marginTop: '1.25rem' }}>
        <h4>{t('triggerFire')}</h4>
        <p className="workflow-settings-lead">{t('triggerFireHint')}</p>
        <div className="workflow-settings-grid">
          <label className="workflow-settings-field">
            <span>{t('triggerSource')}</span>
            <input
              value={fireSource}
              onChange={(event) => setFireSource(event.target.value)}
            />
          </label>
          <label className="workflow-settings-field">
            <span>{t('triggerEventName')}</span>
            <input
              value={fireName}
              onChange={(event) => setFireName(event.target.value)}
            />
          </label>
          <label className="workflow-settings-field">
            <span>{t('triggerData')}</span>
            <textarea
              rows={3}
              value={fireDataJson}
              onChange={(event) => setFireDataJson(event.target.value)}
              placeholder='{"status":"ok"}'
            />
          </label>
        </div>
        <button
          type="button"
          className="workflow-btn primary"
          disabled={busy}
          onClick={() => { void handleFire() }}
        >
          {t('triggerFire')}
        </button>
      </div>
    </div>
  )
}
