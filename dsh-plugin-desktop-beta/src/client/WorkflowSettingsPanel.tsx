import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import type {
  DesktopWorkflowApi,
  WorkflowCustomProviderInput,
  WorkflowLlmProviderPrefView,
  WorkflowModelCatalogView,
  WorkflowOpenAiApiCallView,
  WorkflowOpenAiApiStatusView,
  WorkflowSettingsView,
} from './desktop-workflow-api.js'

interface WorkflowSettingsPanelProps {
  api: DesktopWorkflowApi
  t: (key: WorkflowLocaleKey) => string
}

const BIAS_PRESETS = ['coding', 'review', 'analysis', 'writing', 'general'] as const

function splitRoute(model: string): { provider: string; modelId: string } {
  const slash = model.indexOf('/')
  if (slash <= 0) return { provider: '', modelId: model }
  return { provider: model.slice(0, slash), modelId: model.slice(slash + 1) }
}

function emptyCustom(protocols: readonly string[]): WorkflowCustomProviderInput {
  return {
    routeId: '',
    api: protocols[0] ?? 'openai-completions',
    baseURL: '',
    apiKey: '',
    modelId: '',
    modelName: '',
    displayName: '',
  }
}

/** Workflow LLM routing prefs: pick DSH models or register a full custom gateway. */
export function WorkflowSettingsPanel({ api, t }: WorkflowSettingsPanelProps) {
  const [settings, setSettings] = useState<WorkflowSettingsView>({
    providers: [],
    defaultBias: 'coding',
    defaultRetries: 2,
    defaultOnFailure: 'fail',
    maxRetainedRuns: 200,
    maxRunAgeDays: 30,
  })
  const [catalog, setCatalog] = useState<WorkflowModelCatalogView>({
    protocols: ['openai-completions', 'openai-responses', 'anthropic-messages'],
    providers: [],
  })
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCustom, setShowCustom] = useState(false)
  const [custom, setCustom] = useState<WorkflowCustomProviderInput>(() => emptyCustom([]))
  const [customBias, setCustomBias] = useState<string>('coding')
  const [busyCustom, setBusyCustom] = useState(false)
  const [busyPurge, setBusyPurge] = useState(false)
  const [pickProvider, setPickProvider] = useState('')
  const [pickModel, setPickModel] = useState('')
  const [pickBias, setPickBias] = useState('coding')
  const [openAi, setOpenAi] = useState<WorkflowOpenAiApiStatusView | null>(null)
  const [openAiDraftHost, setOpenAiDraftHost] = useState('127.0.0.1')
  const [openAiDraftPort, setOpenAiDraftPort] = useState(8787)
  const [revealedApiKey, setRevealedApiKey] = useState<string | null>(null)
  const [busyOpenAi, setBusyOpenAi] = useState(false)
  const [openAiCalls, setOpenAiCalls] = useState<WorkflowOpenAiApiCallView[]>([])
  const [busyOpenAiCalls, setBusyOpenAiCalls] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextSettings, nextCatalog, nextOpenAi] = await Promise.all([
        api.getSettings(),
        api.listModelCatalog(),
        api.getOpenAiApiStatus().catch(() => null),
      ])
      setSettings(nextSettings)
      setCatalog(nextCatalog)
      setCustom(emptyCustom(nextCatalog.protocols))
      if (nextCatalog.defaultRoute) setPickProvider(nextCatalog.defaultRoute)
      if (nextCatalog.defaultModel) setPickModel(nextCatalog.defaultModel)
      if (nextOpenAi) {
        setOpenAi(nextOpenAi)
        setOpenAiDraftHost(nextOpenAi.bindHost)
        setOpenAiDraftPort(nextOpenAi.port)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setLoading(false)
    }
  }, [api, t])

  useEffect(() => {
    void load()
  }, [load])

  const loadOpenAiCalls = useCallback(async () => {
    setBusyOpenAiCalls(true)
    try {
      const calls = await api.listOpenAiApiCalls(50)
      setOpenAiCalls(calls)
    } catch {
      // Older Host builds may lack the op; keep the panel usable.
      setOpenAiCalls([])
    } finally {
      setBusyOpenAiCalls(false)
    }
  }, [api])

  useEffect(() => {
    void loadOpenAiCalls()
    const timer = setInterval(() => { void loadOpenAiCalls() }, 4000)
    return () => clearInterval(timer)
  }, [loadOpenAiCalls])

  const clearOpenAiCalls = async (): Promise<void> => {
    if (!confirm(t('openAiApiCallsClearConfirm'))) return
    setBusyOpenAiCalls(true)
    setError(null)
    try {
      await api.clearOpenAiApiCalls()
      setOpenAiCalls([])
      setMessage(t('openAiApiCallsCleared'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setBusyOpenAiCalls(false)
    }
  }

  const pickModels = useMemo(() => {
    const group = catalog.providers.find(entry => entry.id === pickProvider)
    return group?.models ?? []
  }, [catalog.providers, pickProvider])

  const updatePref = (index: number, patch: Partial<WorkflowLlmProviderPrefView>): void => {
    const providers = settings.providers.slice()
    const current = providers[index]
    if (current === undefined) return
    providers[index] = { ...current, ...patch }
    setSettings({ ...settings, providers })
  }

  const addFromCatalog = (): void => {
    if (!pickProvider || !pickModel) {
      setError(t('settingsPickModelRequired'))
      return
    }
    const route = `${pickProvider}/${pickModel}`
    if (settings.providers.some(entry => entry.model === route)) {
      setError(t('settingsProviderExists'))
      return
    }
    setError(null)
    setSettings({
      ...settings,
      providers: [
        ...settings.providers,
        {
          id: `${pickProvider}-${pickModel}`.replace(/[^a-zA-Z0-9-_]/g, '-'),
          model: route,
          bias: pickBias.split(',').map(item => item.trim()).filter(Boolean),
        },
      ],
    })
    setMessage(t('settingsProviderAdded'))
  }

  const save = async (): Promise<void> => {
    setError(null)
    setMessage(null)
    try {
      const saved = await api.setSettings(settings)
      setSettings(saved)
      setMessage(t('settingsSaved'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    }
  }

  const createCustom = async (): Promise<void> => {
    setBusyCustom(true)
    setError(null)
    setMessage(null)
    try {
      const registered = await api.registerCustomProvider(custom)
      const nextCatalog = await api.listModelCatalog()
      setCatalog(nextCatalog)
      const bias = customBias.split(',').map(item => item.trim()).filter(Boolean)
      const pref: WorkflowLlmProviderPrefView = {
        id: registered.provider,
        model: registered.route,
        bias: bias.length > 0 ? bias : ['coding'],
      }
      const providers = settings.providers.some(entry => entry.model === pref.model)
        ? settings.providers
        : [...settings.providers, pref]
      const saved = await api.setSettings({ ...settings, providers })
      setSettings(saved)
      setShowCustom(false)
      setCustom(emptyCustom(nextCatalog.protocols))
      setMessage(t('settingsCustomRegistered'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setBusyCustom(false)
    }
  }

  const purgeRuns = async (): Promise<void> => {
    if (!confirm(t('settingsPurgeConfirm'))) return
    setBusyPurge(true)
    setError(null)
    setMessage(null)
    try {
      const result = await api.purgeRuns()
      setMessage(t('settingsPurged').replace('{count}', String(result.deleted)))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setBusyPurge(false)
    }
  }

  const saveOpenAi = async (enabled: boolean): Promise<void> => {
    setBusyOpenAi(true)
    setError(null)
    setMessage(null)
    setRevealedApiKey(null)
    try {
      const result = await api.setOpenAiApiSettings({
        enabled,
        bindHost: openAiDraftHost.trim() || '127.0.0.1',
        port: Math.max(1, Math.min(65535, openAiDraftPort || 8787)),
      })
      setOpenAi(result.settings)
      setOpenAiDraftHost(result.settings.bindHost)
      setOpenAiDraftPort(result.settings.port)
      if (result.apiKey) setRevealedApiKey(result.apiKey)
      setMessage(enabled ? t('openAiApiEnabled') : t('openAiApiDisabled'))
      if (result.settings.lastError) setError(result.settings.lastError)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setBusyOpenAi(false)
    }
  }

  const rotateOpenAiKey = async (): Promise<void> => {
    if (!confirm(t('openAiApiRotateConfirm'))) return
    setBusyOpenAi(true)
    setError(null)
    setMessage(null)
    try {
      const result = await api.rotateOpenAiApiKey()
      setOpenAi(result.settings)
      setRevealedApiKey(result.apiKey)
      setMessage(t('openAiApiKeyRotated'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setBusyOpenAi(false)
    }
  }

  if (loading) return <div className="workflow-loading">{t('loading')}</div>

  return (
    <div className="workflow-settings">
      <h3>{t('settingsTitle')}</h3>
      <p className="workflow-settings-lead">{t('settingsProvidersHint')}</p>
      {error && <div className="workflow-error">{error}</div>}
      {message && <div className="workflow-success">{message}</div>}

      <div className="workflow-settings-grid">
        <label className="workflow-settings-field">
          <span>{t('settingsDefaultBias')}</span>
          <input
            value={settings.defaultBias}
            onChange={(event) => setSettings({
              ...settings,
              defaultBias: event.target.value,
            })}
          />
        </label>

        <label className="workflow-settings-field">
          <span>{t('settingsDefaultRetries')}</span>
          <input
            type="number"
            min={0}
            value={settings.defaultRetries}
            onChange={(event) => setSettings({
              ...settings,
              defaultRetries: Math.max(0, Number(event.target.value) || 0),
            })}
          />
        </label>

        <label className="workflow-settings-field">
          <span>{t('settingsDefaultOnFailure')}</span>
          <select
            value={settings.defaultOnFailure}
            onChange={(event) => {
              const value = event.target.value
              if (value === 'fail' || value === 'skip' || value === 'compensate') {
                setSettings({ ...settings, defaultOnFailure: value })
              }
            }}
          >
            <option value="fail">{t('stepOnFailureFail')}</option>
            <option value="skip">{t('stepOnFailureSkip')}</option>
            <option value="compensate">{t('stepOnFailureCompensate')}</option>
          </select>
        </label>

        <label className="workflow-settings-field">
          <span>{t('settingsScriptPolicy')}</span>
          <select
            value={settings.scriptPolicy ?? 'workspace-only'}
            onChange={(event) => {
              const value = event.target.value
              if (value === 'allow' || value === 'deny' || value === 'workspace-only') {
                setSettings({ ...settings, scriptPolicy: value })
              }
            }}
          >
            <option value="allow">{t('settingsScriptPolicyAllow')}</option>
            <option value="workspace-only">{t('settingsScriptPolicyWorkspace')}</option>
            <option value="deny">{t('settingsScriptPolicyDeny')}</option>
          </select>
        </label>

        <label className="workflow-settings-field">
          <span>{t('settingsMaxRetainedRuns')}</span>
          <input
            type="number"
            min={0}
            value={settings.maxRetainedRuns ?? 0}
            onChange={(event) => setSettings({
              ...settings,
              maxRetainedRuns: Math.max(0, Number(event.target.value) || 0),
            })}
          />
        </label>

        <label className="workflow-settings-field">
          <span>{t('settingsMaxRunAgeDays')}</span>
          <input
            type="number"
            min={0}
            value={settings.maxRunAgeDays ?? 0}
            onChange={(event) => setSettings({
              ...settings,
              maxRunAgeDays: Math.max(0, Number(event.target.value) || 0),
            })}
          />
        </label>
      </div>

      <p className="workflow-settings-lead">{t('settingsRetentionHint')}</p>
      <button
        type="button"
        className="workflow-btn small"
        disabled={busyPurge}
        onClick={() => { void purgeRuns() }}
        style={{ marginBottom: '1rem' }}
      >
        {busyPurge ? t('loading') : t('settingsPurgeRuns')}
      </button>

      <div className="workflow-settings-openai">
        <h4>{t('openAiApiTitle')}</h4>
        <p className="workflow-settings-lead">{t('openAiApiHint')}</p>
        {!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(openAiDraftHost.trim().toLowerCase()) && (
          <p className="workflow-settings-lead" style={{ color: '#c0392b' }}>
            {t('openAiApiLanWarning')}
          </p>
        )}
        <div className="workflow-settings-grid">
          <label className="workflow-settings-field">
            <span>{t('openAiApiBindHost')}</span>
            <input
              value={openAiDraftHost}
              onChange={(event) => setOpenAiDraftHost(event.target.value)}
              placeholder="127.0.0.1"
            />
          </label>
          <label className="workflow-settings-field">
            <span>{t('openAiApiPort')}</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={openAiDraftPort}
              onChange={(event) => setOpenAiDraftPort(Number(event.target.value) || 8787)}
            />
          </label>
        </div>
        {openAi && (
          <p className="workflow-settings-lead">
            {t('openAiApiStatus')}: {openAi.listening ? t('openAiApiListening') : t('openAiApiStopped')}
            {openAi.usingTls ? ` · TLS` : ' · HTTP'}
            {openAi.baseUrl ? ` · ${openAi.baseUrl}` : ''}
            {openAi.hasApiKey ? ` · ${t('openAiApiHasKey')}` : ` · ${t('openAiApiNoKey')}`}
          </p>
        )}
        {revealedApiKey && (
          <div className="workflow-settings-openai-key">
            <strong>{t('openAiApiKeyOnce')}</strong>
            <code>{revealedApiKey}</code>
          </div>
        )}
        <div className="workflow-settings-provider-actions" style={{ marginBottom: '1rem', gap: 8 }}>
          <button
            type="button"
            className="workflow-btn small primary"
            disabled={busyOpenAi}
            onClick={() => { void saveOpenAi(true) }}
          >
            {busyOpenAi ? t('loading') : t('openAiApiEnable')}
          </button>
          <button
            type="button"
            className="workflow-btn small"
            disabled={busyOpenAi || !openAi?.enabled}
            onClick={() => { void saveOpenAi(false) }}
          >
            {t('openAiApiDisable')}
          </button>
          <button
            type="button"
            className="workflow-btn small"
            disabled={busyOpenAi}
            onClick={() => { void rotateOpenAiKey() }}
          >
            {t('openAiApiRotate')}
          </button>
        </div>

        <div className="workflow-settings-openai-calls">
          <div className="workflow-list-header" style={{ marginBottom: 8 }}>
            <h4 style={{ margin: 0 }}>{t('openAiApiCallsTitle')}</h4>
            <div className="workflow-settings-provider-actions" style={{ gap: 8 }}>
              <button
                type="button"
                className="workflow-btn small"
                disabled={busyOpenAiCalls}
                onClick={() => { void loadOpenAiCalls() }}
              >
                {busyOpenAiCalls ? t('loading') : t('openAiApiCallsRefresh')}
              </button>
              <button
                type="button"
                className="workflow-btn small danger"
                disabled={busyOpenAiCalls || openAiCalls.length === 0}
                onClick={() => { void clearOpenAiCalls() }}
              >
                {t('openAiApiCallsClear')}
              </button>
            </div>
          </div>
          <p className="workflow-settings-lead">{t('openAiApiCallsHint')}</p>
          {openAiCalls.length === 0 ? (
            <p className="workflow-settings-lead">{t('openAiApiCallsEmpty')}</p>
          ) : (
            <div className="workflow-openai-call-list" role="list">
              {openAiCalls.map((call) => (
                <div
                  key={call.id}
                  className={`workflow-openai-call-row ${call.ok ? 'ok' : 'fail'}`}
                  role="listitem"
                >
                  <div className="workflow-openai-call-main">
                    <span className={`workflow-openai-call-badge ${call.ok ? 'ok' : 'fail'}`}>
                      {call.ok ? t('openAiApiCallOk') : t('openAiApiCallFail')}
                    </span>
                    <strong>{call.model || call.workflowName || '—'}</strong>
                    <span className="workflow-openai-call-meta">
                      {call.statusCode}
                      {typeof call.durationMs === 'number' ? ` · ${t('openAiApiCallDuration')} ${call.durationMs}ms` : ''}
                      {call.stream ? ' · stream' : ''}
                    </span>
                  </div>
                  <div className="workflow-openai-call-meta">
                    <span>{new Date(call.ts).toLocaleString()}</span>
                    <span>{call.clientIp}</span>
                    {call.runId && (
                      <span>{t('openAiApiCallRun')}: {call.runId}</span>
                    )}
                  </div>
                  {call.error && (
                    <div className="workflow-openai-call-error">{call.error}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>


      <div className="workflow-settings-providers">
        <div className="workflow-settings-providers-header">
          <strong>{t('settingsProviders')}</strong>
          <div className="workflow-settings-provider-actions">
            <button
              type="button"
              className="workflow-btn small"
              onClick={() => setShowCustom(value => !value)}
            >
              {showCustom ? t('cancel') : t('settingsAddCustomProvider')}
            </button>
          </div>
        </div>

        <div className="workflow-settings-picker">
          <label className="workflow-settings-field">
            <span>{t('settingsPickProvider')}</span>
            <select
              value={pickProvider}
              onChange={(event) => {
                setPickProvider(event.target.value)
                setPickModel('')
              }}
            >
              <option value="">{t('settingsPickProviderPlaceholder')}</option>
              {catalog.providers.map(group => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>
          </label>
          <label className="workflow-settings-field">
            <span>{t('settingsPickModel')}</span>
            <select
              value={pickModel}
              disabled={!pickProvider}
              onChange={(event) => setPickModel(event.target.value)}
            >
              <option value="">{t('settingsPickModelPlaceholder')}</option>
              {pickModels.map(model => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
          </label>
          <label className="workflow-settings-field">
            <span>{t('settingsBias')}</span>
            <input
              list="workflow-bias-presets"
              value={pickBias}
              onChange={(event) => setPickBias(event.target.value)}
              placeholder="coding, review"
            />
          </label>
          <button type="button" className="workflow-btn small primary" onClick={addFromCatalog}>
            {t('settingsAddFromCatalog')}
          </button>
        </div>
        <datalist id="workflow-bias-presets">
          {BIAS_PRESETS.map(bias => <option key={bias} value={bias} />)}
        </datalist>

        {catalog.providers.length === 0 && (
          <p className="workflow-settings-empty">{t('settingsCatalogEmpty')}</p>
        )}

        {showCustom && (
          <div className="workflow-settings-custom">
            <h4>{t('settingsCustomTitle')}</h4>
            <p className="workflow-settings-lead">{t('settingsCustomHint')}</p>
            <div className="workflow-settings-grid">
              <label className="workflow-settings-field">
                <span>{t('settingsCustomRoute')}</span>
                <input
                  value={custom.routeId}
                  placeholder="acme-gateway"
                  onChange={(event) => setCustom({ ...custom, routeId: event.target.value })}
                />
              </label>
              <label className="workflow-settings-field">
                <span>{t('settingsCustomDisplayName')}</span>
                <input
                  value={custom.displayName ?? ''}
                  onChange={(event) => setCustom({ ...custom, displayName: event.target.value })}
                />
              </label>
              <label className="workflow-settings-field">
                <span>{t('settingsCustomProtocol')}</span>
                <select
                  value={custom.api}
                  onChange={(event) => setCustom({ ...custom, api: event.target.value })}
                >
                  {catalog.protocols.map(protocol => (
                    <option key={protocol} value={protocol}>{protocol}</option>
                  ))}
                </select>
              </label>
              <label className="workflow-settings-field">
                <span>{t('settingsCustomBaseUrl')}</span>
                <input
                  value={custom.baseURL}
                  placeholder="https://api.example.com/v1"
                  onChange={(event) => setCustom({ ...custom, baseURL: event.target.value })}
                />
              </label>
              <label className="workflow-settings-field">
                <span>{t('settingsCustomApiKey')}</span>
                <input
                  type="password"
                  value={custom.apiKey ?? ''}
                  placeholder="sk-..."
                  onChange={(event) => setCustom({ ...custom, apiKey: event.target.value })}
                />
              </label>
              <label className="workflow-settings-field">
                <span>{t('settingsCustomModelId')}</span>
                <input
                  value={custom.modelId}
                  placeholder="gpt-4.1"
                  onChange={(event) => setCustom({ ...custom, modelId: event.target.value })}
                />
              </label>
              <label className="workflow-settings-field">
                <span>{t('settingsBias')}</span>
                <input
                  list="workflow-bias-presets"
                  value={customBias}
                  onChange={(event) => setCustomBias(event.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              className="workflow-btn primary"
              disabled={busyCustom}
              onClick={() => { void createCustom() }}
            >
              {busyCustom ? t('loading') : t('settingsRegisterCustom')}
            </button>
          </div>
        )}

        {settings.providers.length === 0 ? (
          <p className="workflow-settings-empty">{t('settingsProvidersEmpty')}</p>
        ) : (
          settings.providers.map((provider, index) => {
            const parsed = splitRoute(provider.model)
            const group = catalog.providers.find(entry => entry.id === parsed.provider)
            const models = group?.models ?? []
            return (
              <div key={`${provider.id}-${index}`} className="workflow-settings-provider-card">
                <div className="workflow-settings-grid">
                  <label className="workflow-settings-field">
                    <span>{t('settingsProviderId')}</span>
                    <input
                      value={provider.id}
                      onChange={(event) => updatePref(index, { id: event.target.value })}
                    />
                  </label>
                  <label className="workflow-settings-field">
                    <span>{t('settingsPickProvider')}</span>
                    <select
                      value={parsed.provider}
                      onChange={(event) => {
                        const nextProvider = event.target.value
                        const nextModels = catalog.providers.find(entry => entry.id === nextProvider)?.models ?? []
                        const nextModel = nextModels[0]?.id ?? ''
                        updatePref(index, {
                          model: nextModel ? `${nextProvider}/${nextModel}` : `${nextProvider}/`,
                        })
                      }}
                    >
                      {!group && parsed.provider && (
                        <option value={parsed.provider}>{parsed.provider} ({t('settingsUnknownRoute')})</option>
                      )}
                      {catalog.providers.map(entry => (
                        <option key={entry.id} value={entry.id}>{entry.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="workflow-settings-field">
                    <span>{t('settingsPickModel')}</span>
                    <select
                      value={parsed.modelId}
                      onChange={(event) => updatePref(index, {
                        model: `${parsed.provider}/${event.target.value}`,
                      })}
                    >
                      {!models.some(model => model.id === parsed.modelId) && parsed.modelId && (
                        <option value={parsed.modelId}>{parsed.modelId}</option>
                      )}
                      {models.map(model => (
                        <option key={model.id} value={model.id}>{model.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="workflow-settings-field">
                    <span>{t('settingsBias')}</span>
                    <input
                      list="workflow-bias-presets"
                      value={provider.bias.join(', ')}
                      onChange={(event) => updatePref(index, {
                        bias: event.target.value.split(',').map(item => item.trim()).filter(Boolean),
                      })}
                    />
                  </label>
                </div>
                <div className="workflow-settings-provider-card-foot">
                  <code>{provider.model}</code>
                  <button
                    type="button"
                    className="workflow-btn small danger"
                    onClick={() => setSettings({
                      ...settings,
                      providers: settings.providers.filter((_, i) => i !== index),
                    })}
                  >
                    {t('delete')}
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      <button type="button" className="workflow-btn primary" onClick={() => void save()}>
        {t('settingsSave')}
      </button>
    </div>
  )
}
