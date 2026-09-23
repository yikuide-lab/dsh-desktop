import { useCallback, useEffect, useState } from 'react'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import type {
  DesktopWorkflowApi,
  AwfAuthAccountView,
  AwfAuthMethodsView,
  AwfExecutorStatusView,
  AwfStatusView,
  AwfConnectionView,
  AwfSyncReceiptView,
  AwfTunnelStatusView,
} from './desktop-workflow-api.js'

interface WorkflowAwfPanelProps {
  api: DesktopWorkflowApi
  t: (key: WorkflowLocaleKey) => string
}

/** AWF platform connection & operations: auth, connection, sync, remote run, executor, tunnel. */
export function WorkflowAwfPanel({ api, t }: WorkflowAwfPanelProps) {
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [awf, setAwf] = useState<AwfStatusView | null>(null)
  const [awfDraftBaseUrl, setAwfDraftBaseUrl] = useState('')
  const [awfDraftEnv, setAwfDraftEnv] = useState('AWF_API_TOKEN')
  const [awfDraftToken, setAwfDraftToken] = useState('')
  const [awfConn, setAwfConn] = useState<AwfConnectionView | null>(null)
  const [awfSyncName, setAwfSyncName] = useState('')
  const [awfSyncVisibility, setAwfSyncVisibility] = useState('private')
  const [awfPublish, setAwfPublish] = useState(false)
  const [awfReceipt, setAwfReceipt] = useState<AwfSyncReceiptView | null>(null)
  const [busyAwf, setBusyAwf] = useState(false)
  const [awfRunWfId, setAwfRunWfId] = useState('')
  const [awfRunPrompt, setAwfRunPrompt] = useState('')
  const [awfRunResult, setAwfRunResult] = useState<string | null>(null)
  const [awfExecutorStatus, setAwfExecutorStatus] = useState<AwfExecutorStatusView | null>(null)
  const [awfTunnelStatus, setAwfTunnelStatus] = useState<AwfTunnelStatusView | null>(null)
  const [awfAuth, setAwfAuth] = useState<AwfAuthAccountView | null>(null)
  const [awfAuthMethodsView, setAwfAuthMethodsView] = useState<AwfAuthMethodsView | null>(null)
  const [awfAuthMode, setAwfAuthMode] = useState<'email' | 'phone'>('email')
  const [awfAuthEmail, setAwfAuthEmail] = useState('')
  const [awfAuthPassword, setAwfAuthPassword] = useState('')
  const [awfAuthDisplayName, setAwfAuthDisplayName] = useState('')
  const [awfAuthPhone, setAwfAuthPhone] = useState('')
  const [awfAuthCode, setAwfAuthCode] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const nextAwf = await api.getAwfStatus().catch(() => null)
      if (nextAwf) {
        setAwf(nextAwf)
        setAwfDraftBaseUrl(nextAwf.baseUrl)
        setAwfDraftEnv(nextAwf.apiTokenEnv)
      }
      setAwfExecutorStatus(await api.getAwfExecutorStatus().catch(() => null))
      setAwfTunnelStatus(await api.getAwfTunnelStatus().catch(() => null))
      setAwfAuth(await api.getAwfAuthStatus().catch(() => null))
      setAwfAuthMethodsView(await api.getAwfAuthMethods().catch(() => null))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setLoading(false)
    }
  }, [api, t])

  useEffect(() => {
    void load()
  }, [load])

  const saveAwfSettings = async (): Promise<void> => {
    setBusyAwf(true)
    setError(null)
    setMessage(null)
    try {
      const next = await api.setAwfSettings({
        baseUrl: awfDraftBaseUrl.trim(),
        apiTokenEnv: awfDraftEnv.trim(),
        // 空串清除已保存 token，回到 env-only
        apiToken: awfDraftToken,
      })
      setAwf(next)
      setAwfDraftToken('')
      setAwfConn(null)
      setMessage(t('awfSaved'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setBusyAwf(false)
    }
  }

  const checkAwfConnection = async (): Promise<void> => {
    setBusyAwf(true)
    setError(null)
    try {
      setAwfConn(await api.checkAwfConnection())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setBusyAwf(false)
    }
  }

  const refreshAwfAccount = async (): Promise<void> => {
    setAwfAuth(await api.getAwfAuthStatus().catch(() => null))
  }

  const submitAwfAuth = async (kind: 'register' | 'login'): Promise<void> => {
    setError(null)
    if (!awfAuthEmail.trim() || !awfAuthPassword) {
      setError(t('awfAuthNeedEmailPassword'))
      return
    }
    setBusyAwf(true)
    try {
      const result = kind === 'register'
        ? await api.awfAuthRegister({
            email: awfAuthEmail.trim(),
            password: awfAuthPassword,
            ...(awfAuthDisplayName.trim() ? { displayName: awfAuthDisplayName.trim() } : {}),
          })
        : await api.awfAuthLogin({ email: awfAuthEmail.trim(), password: awfAuthPassword })
      if (result.hasSession) {
        setAwfAuth(result)
        setAwfAuthPassword('')
        setMessage(t('awfAuthOk'))
        setAwfConn(await api.checkAwfConnection().catch(() => null))
      } else {
        setError(result.errorMessage ?? t('awfAuthFailed'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setBusyAwf(false)
    }
  }

  const sendAwfPhoneCode = async (): Promise<void> => {
    setError(null)
    if (!awfAuthPhone.trim()) {
      setError(t('awfAuthNeedPhoneCode'))
      return
    }
    setBusyAwf(true)
    try {
      const result = await api.awfAuthSendPhoneCode(awfAuthPhone.trim())
      if (result.ok) setMessage(t('awfAuthSent'))
      else setError(result.errorMessage ?? t('awfAuthFailed'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setBusyAwf(false)
    }
  }

  const submitAwfPhoneAuth = async (): Promise<void> => {
    setError(null)
    if (!awfAuthPhone.trim() || !awfAuthCode.trim()) {
      setError(t('awfAuthNeedPhoneCode'))
      return
    }
    setBusyAwf(true)
    try {
      const result = await api.awfAuthPhoneLogin({ phone: awfAuthPhone.trim(), code: awfAuthCode.trim() })
      if (result.hasSession) {
        setAwfAuth(result)
        setAwfAuthCode('')
        setMessage(t('awfAuthOk'))
        setAwfConn(await api.checkAwfConnection().catch(() => null))
      } else {
        setError(result.errorMessage ?? t('awfAuthFailed'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setBusyAwf(false)
    }
  }

  const logoutAwfAuth = async (): Promise<void> => {
    setError(null)
    try {
      await api.awfAuthLogout()
      await refreshAwfAccount()
      setMessage(t('awfAuthSignedOut'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    }
  }

  const toggleAwfTelemetry = async (enabled: boolean): Promise<void> => {
    setError(null)
    try {
      setAwf(await api.setAwfTelemetrySettings(enabled))
      setMessage(t('awfSaved'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    }
  }

  const toggleAwfExecutor = async (enabled: boolean): Promise<void> => {
    setError(null)
    try {
      setAwf(await api.setAwfExecutorSettings(enabled))
      setMessage(t('awfSaved'))
      setAwfExecutorStatus(await api.getAwfExecutorStatus())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    }
  }

  const toggleAwfTunnel = async (enabled: boolean): Promise<void> => {
    setError(null)
    try {
      setAwf(await api.setAwfTunnelSettings(enabled, 8787))
      setMessage(t('awfSaved'))
      setAwfTunnelStatus(await api.getAwfTunnelStatus())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    }
  }

  const syncAwf = async (): Promise<void> => {
    if (!awfSyncName.trim()) {
      setError(t('awfSyncNameRequired'))
      return
    }
    setBusyAwf(true)
    setError(null)
    setAwfReceipt(null)
    try {
      setAwfReceipt(await api.syncWorkflowToAwf(awfSyncName.trim(), awfSyncVisibility, undefined, awfPublish))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setBusyAwf(false)
    }
  }

  const remoteRunAwf = async (): Promise<void> => {
    const id = Number(awfRunWfId)
    if (!Number.isInteger(id) || id <= 0) {
      setError(t('awfRunIdRequired'))
      return
    }
    setBusyAwf(true)
    setError(null)
    setAwfRunResult(null)
    try {
      const result = await api.remoteRunOnAwf(id, awfRunPrompt.trim() ? { PROMPT: awfRunPrompt.trim() } : {})
      if (result.ok) {
        setAwfRunResult(`${t('awfRunOk')} [${result.status}] ${result.resultText ?? result.errorText ?? ''}`.trim())
      } else {
        setAwfRunResult(`${t('awfRunFailed')} [${result.errorKind ?? 'unknown'}] ${result.errorMessage ?? ''}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setBusyAwf(false)
    }
  }


  if (loading) return <div className="workflow-loading">{t('loading')}</div>

  return (
    <div className="workflow-awf-panel">
      {error && <div className="workflow-error" role="alert">{error}</div>}
      {message && <div className="workflow-success">{message}</div>}
      <div className="workflow-settings-openai">
        <h4>{t('awfTitle')}</h4>
        <p className="workflow-settings-lead">{t('awfHint')}</p>

        <div style={{ marginBottom: '1rem' }}>
          {awfAuth?.hasSession ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="workflow-settings-lead" style={{ margin: 0 }}>
                {t('awfAuthAccount')}: {awfAuth.email ?? ''}{awfAuth.displayName ? ` (${awfAuth.displayName})` : ''}
              </span>
              <button
                type="button"
                className="workflow-btn small"
                disabled={busyAwf}
                onClick={() => { void logoutAwfAuth() }}
              >
                {t('awfAuthLogout')}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="workflow-settings-provider-actions" style={{ gap: 8 }}>
                <button
                  type="button"
                  className={`workflow-btn small ${awfAuthMode === 'email' ? 'primary' : ''}`}
                  onClick={() => { setAwfAuthMode('email') }}
                >
                  {t('awfAuthEmailTab')}
                </button>
                <button
                  type="button"
                  className={`workflow-btn small ${awfAuthMode === 'phone' ? 'primary' : ''}`}
                  onClick={() => { setAwfAuthMode('phone') }}
                >
                  {t('awfAuthPhoneTab')}
                </button>
                <button
                  type="button"
                  className="workflow-btn small"
                  disabled
                  title={awfAuthMethodsView?.wechatReason ?? t('awfAuthWechatUnavailable')}
                >
                  {t('awfAuthWechatTab')}
                </button>
              </div>
              {awfAuthMode === 'email' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="workflow-settings-grid">
                    <label className="workflow-settings-field">
                      <span>{t('awfAuthEmail')}</span>
                      <input
                        value={awfAuthEmail}
                        onChange={(event) => setAwfAuthEmail(event.target.value)}
                        placeholder="you@example.com"
                        autoComplete="off"
                      />
                    </label>
                    <label className="workflow-settings-field">
                      <span>{t('awfAuthPassword')}</span>
                      <input
                        type="password"
                        value={awfAuthPassword}
                        onChange={(event) => setAwfAuthPassword(event.target.value)}
                        placeholder={t('awfAuthPasswordPlaceholder')}
                        autoComplete="new-password"
                      />
                    </label>
                  </div>
                  <label className="workflow-settings-field" style={{ maxWidth: 320 }}>
                    <span>{t('awfAuthDisplayName')}</span>
                    <input
                      value={awfAuthDisplayName}
                      onChange={(event) => setAwfAuthDisplayName(event.target.value)}
                      placeholder={t('awfAuthDisplayNamePlaceholder')}
                    />
                  </label>
                  <div className="workflow-settings-provider-actions" style={{ gap: 8 }}>
                    <button
                      type="button"
                      className="workflow-btn small primary"
                      disabled={busyAwf}
                      onClick={() => { void submitAwfAuth('register') }}
                    >
                      {t('awfAuthRegister')}
                    </button>
                    <button
                      type="button"
                      className="workflow-btn small"
                      disabled={busyAwf}
                      onClick={() => { void submitAwfAuth('login') }}
                    >
                      {t('awfAuthLogin')}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="workflow-settings-grid">
                    <label className="workflow-settings-field">
                      <span>{t('awfAuthPhone')}</span>
                      <input
                        value={awfAuthPhone}
                        onChange={(event) => setAwfAuthPhone(event.target.value)}
                        placeholder="+8613800000000"
                        autoComplete="off"
                      />
                    </label>
                    <label className="workflow-settings-field">
                      <span>{t('awfAuthCode')}</span>
                      <input
                        value={awfAuthCode}
                        onChange={(event) => setAwfAuthCode(event.target.value)}
                        placeholder="000000"
                        autoComplete="one-time-code"
                      />
                    </label>
                  </div>
                  <div className="workflow-settings-provider-actions" style={{ gap: 8 }}>
                    <button
                      type="button"
                      className="workflow-btn small"
                      disabled={busyAwf}
                      onClick={() => { void sendAwfPhoneCode() }}
                    >
                      {t('awfAuthSendCode')}
                    </button>
                    <button
                      type="button"
                      className="workflow-btn small primary"
                      disabled={busyAwf}
                      onClick={() => { void submitAwfPhoneAuth() }}
                    >
                      {t('awfAuthPhoneLoginBtn')}
                    </button>
                  </div>
                </div>
              )}
              <p className="workflow-settings-lead" style={{ margin: 0 }}>{t('awfAuthHint')}</p>
            </div>
          )}
        </div>

        <div className="workflow-settings-grid">
          <label className="workflow-settings-field">
            <span>{t('awfBaseUrl')}</span>
            <input
              value={awfDraftBaseUrl}
              onChange={(event) => setAwfDraftBaseUrl(event.target.value)}
              placeholder="http://127.0.0.1:8000"
            />
          </label>
          <label className="workflow-settings-field">
            <span>{t('awfTokenEnv')}</span>
            <input
              value={awfDraftEnv}
              onChange={(event) => setAwfDraftEnv(event.target.value)}
              placeholder="AWF_API_TOKEN"
            />
          </label>
        </div>
        <label className="workflow-settings-field" style={{ display: 'block', marginBottom: 8 }}>
          <span>{t('awfTokenSave')}</span>
          <input
            type="password"
            value={awfDraftToken}
            onChange={(event) => setAwfDraftToken(event.target.value)}
            placeholder={t('awfTokenSavePlaceholder')}
            autoComplete="off"
          />
        </label>
        {awf && (
          <p className="workflow-settings-lead">
            {awf.hasToken
              ? `${t('awfStatusToken')}: ${awf.tokenFingerprint}`
              : t('awfStatusNoToken')}
          </p>
        )}
        {awfConn && (
          <p className="workflow-settings-lead">
            {awfConn.ok
              ? `${t('awfCheckOk')}${awfConn.email ? ` (${awfConn.email})` : ''}`
              : `${t('awfCheckFailed')} [${awfConn.errorKind ?? 'unknown'}] ${awfConn.errorMessage ?? ''}`}
          </p>
        )}
        <div className="workflow-settings-provider-actions" style={{ marginBottom: '1rem', gap: 8 }}>
          <button
            type="button"
            className="workflow-btn small primary"
            disabled={busyAwf}
            onClick={() => { void saveAwfSettings() }}
          >
            {busyAwf ? t('loading') : t('awfSave')}
          </button>
          <button
            type="button"
            className="workflow-btn small"
            disabled={busyAwf}
            onClick={() => { void checkAwfConnection() }}
          >
            {t('awfCheck')}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: '1rem' }}>
          <label className="workflow-settings-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={awf?.telemetryEnabled ?? false}
              onChange={(event) => { void toggleAwfTelemetry(event.target.checked) }}
            />
            <span>{t('awfTelemetry')}</span>
          </label>
          <p className="workflow-settings-lead" style={{ margin: 0 }}>{t('awfTelemetryHint')}</p>
          <label className="workflow-settings-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={awf?.executorEnabled ?? false}
              onChange={(event) => { void toggleAwfExecutor(event.target.checked) }}
            />
            <span>{t('awfExecutor')}</span>
          </label>
          <p className="workflow-settings-lead" style={{ margin: 0 }}>{t('awfExecutorHint')}</p>
          {awfExecutorStatus && (
            <p className="workflow-settings-lead" style={{ margin: 0 }}>
              {awfExecutorStatus.running
                ? `${t('awfExecutorRunning')}${awfExecutorStatus.executorId !== null ? ` #${awfExecutorStatus.executorId}` : ''}`
                : t('awfExecutorIdle')}
              {awfExecutorStatus.lastError ? ` — ${t('awfExecutorError')}: ${awfExecutorStatus.lastError}` : ''}
            </p>
          )}
          <label className="workflow-settings-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={awf?.tunnelEnabled ?? false}
              onChange={(event) => { void toggleAwfTunnel(event.target.checked) }}
            />
            <span>{t('awfTunnel')}</span>
          </label>
          <p className="workflow-settings-lead" style={{ margin: 0 }}>{t('awfTunnelHint')}</p>
          {awfTunnelStatus && (
            <p className="workflow-settings-lead" style={{ margin: 0 }}>
              {awfTunnelStatus.connected
                ? `${t('awfTunnelConnected')} :${awfTunnelStatus.localPort}${awfTunnelStatus.executorId !== null ? ` (executor #${awfTunnelStatus.executorId})` : ''}`
                : t('awfTunnelDisconnected')}
              {awfTunnelStatus.error ? ` — ${awfTunnelStatus.error}` : ''}
              {awfTunnelStatus.since ? ` (${t('since')} ${new Date(awfTunnelStatus.since).toLocaleString()})` : ''}
            </p>
          )}
        </div>

        <h4>{t('awfSyncTitle')}</h4>
        <p className="workflow-settings-lead">{t('awfSyncHint')}</p>
        <div className="workflow-settings-grid">
          <label className="workflow-settings-field">
            <span>{t('name')}</span>
            <input
              value={awfSyncName}
              onChange={(event) => setAwfSyncName(event.target.value)}
              placeholder="my-workflow"
            />
          </label>
          <label className="workflow-settings-field">
            <span>{t('awfSyncVisibility')}</span>
            <select
              value={awfSyncVisibility}
              onChange={(event) => setAwfSyncVisibility(event.target.value)}
            >
              <option value="private">private</option>
              <option value="unlisted">unlisted</option>
              <option value="public">public</option>
            </select>
          </label>
        </div>
        <div className="workflow-settings-provider-actions" style={{ marginBottom: '1rem', gap: 8 }}>
          <label className="workflow-settings-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={awfPublish}
              onChange={(event) => setAwfPublish(event.target.checked)}
            />
            <span>{t('awfPublishAfterSync')}</span>
          </label>
          <button
            type="button"
            className="workflow-btn small primary"
            disabled={busyAwf}
            onClick={() => { void syncAwf() }}
          >
            {busyAwf ? t('loading') : t('awfSyncButton')}
          </button>
        </div>
        {awfReceipt && (
          <div className="workflow-settings-lead">
            {awfReceipt.ok
              ? `${t('awfSyncOk')}: ${awfReceipt.workflow?.name ?? ''} #${awfReceipt.workflow?.id ?? ''} (${awfReceipt.workflow?.status ?? ''})`
              : awfReceipt.stage === 'preflight'
                ? `${t('awfSyncPreflightFailed')}${awfReceipt.validation?.conflict ? ` — ${awfReceipt.validation.conflict}` : ''}`
                : `${t('awfSyncError')} [${awfReceipt.errorKind ?? 'unknown'}] ${awfReceipt.errorMessage ?? ''}`}
            {awfReceipt.validation && !awfReceipt.validation.ok && awfReceipt.validation.errors.length > 0 && (
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {awfReceipt.validation.errors.slice(0, 5).map((e, i) => (
                  <li key={i}><code>{e.path}</code>: {e.msg}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <h4>{t('awfRunTitle')}</h4>
        <p className="workflow-settings-lead">{t('awfRunHint')}</p>
        <div className="workflow-settings-grid">
          <label className="workflow-settings-field">
            <span>{t('awfRunWorkflowId')}</span>
            <input
              type="number"
              min={1}
              value={awfRunWfId}
              onChange={(event) => setAwfRunWfId(event.target.value)}
              placeholder="12"
            />
          </label>
          <label className="workflow-settings-field">
            <span>PROMPT</span>
            <input
              value={awfRunPrompt}
              onChange={(event) => setAwfRunPrompt(event.target.value)}
              placeholder="hello"
            />
          </label>
        </div>
        <div className="workflow-settings-provider-actions" style={{ marginBottom: '1rem', gap: 8 }}>
          <button
            type="button"
            className="workflow-btn small primary"
            disabled={busyAwf}
            onClick={() => { void remoteRunAwf() }}
          >
            {busyAwf ? t('loading') : t('awfRunButton')}
          </button>
        </div>
        {awfRunResult && <p className="workflow-settings-lead">{awfRunResult}</p>}
      </div>
    </div>
  )
}
