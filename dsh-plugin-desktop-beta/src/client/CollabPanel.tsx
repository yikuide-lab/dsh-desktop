import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import {
  createDesktopCollabApi,
  DEFAULT_COLLAB_ACTOR_JID,
} from './collab-api.js'

type CollabTab = 'vision' | 'roster' | 'network' | 'heal' | 'plan' | 'control'

interface CollabPanelProps {
  loopId?: string
  actorJid?: string
  t: (key: WorkflowLocaleKey) => string
}

function tabLabel(tab: CollabTab, t: (key: WorkflowLocaleKey) => string): string {
  switch (tab) {
    case 'vision': return t('collabTabVision')
    case 'roster': return t('collabTabRoster')
    case 'network': return t('collabTabNetwork')
    case 'heal': return t('collabTabHeal')
    case 'plan': return t('collabTabPlan')
    case 'control': return t('collabTabControl')
  }
}

const HEAL_AUTO_OPTIONS = ['nudge_rejoin', 'reassign_goal', 'invite'] as const

/** Minimal Collab Loop control surface (Vision / Roster / Network / Heal / Task Plan / Control). */
export function CollabPanel({
  loopId: initialLoopId = '',
  actorJid = DEFAULT_COLLAB_ACTOR_JID,
  t,
}: CollabPanelProps) {
  const api = useMemo(() => createDesktopCollabApi(), [])
  const [loopId, setLoopId] = useState(initialLoopId)
  const [tab, setTab] = useState<CollabTab>('vision')
  const [payload, setPayload] = useState<unknown>(null)
  const [healPlan, setHealPlan] = useState<unknown>(null)
  const [inviteJid, setInviteJid] = useState('')
  const [inviteSlot, setInviteSlot] = useState('')
  const [inviteDid, setInviteDid] = useState('')
  const [kickJid, setKickJid] = useState('')
  const [planHint, setPlanHint] = useState('')
  const [aspEndpoint, setAspEndpoint] = useState('127.0.0.1:9700')
  const [allowRemotePeers, setAllowRemotePeers] = useState(false)
  const [canHealAuto, setCanHealAuto] = useState(false)
  const [healAutoAllow, setHealAutoAllow] = useState<string[]>([...HEAL_AUTO_OPTIONS])
  const [deputyJid, setDeputyJid] = useState('')
  const [deputyGrantsText, setDeputyGrantsText] = useState('read,invite')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoopId(initialLoopId)
  }, [initialLoopId])

  const requireLoop = (): string | null => {
    const trimmed = loopId.trim()
    if (!trimmed) {
      setError(`${t('collabLoopId')} required`)
      return null
    }
    return trimmed
  }

  const refresh = useCallback(async () => {
    const id = requireLoop()
    if (!id) return
    setBusy(true)
    setError(null)
    try {
      if (tab === 'vision') {
        const result = await api.call<{ vision: unknown }>({
          op: 'vision.get',
          loopId: id,
          actorJid,
        })
        setPayload(result.vision)
      } else if (tab === 'roster') {
        const result = await api.call<{ roster: unknown }>({
          op: 'roster.get',
          loopId: id,
          actorJid,
        })
        setPayload(result.roster)
      } else if (tab === 'network') {
        const result = await api.call<{ snapshot: unknown }>({
          op: 'network.snapshot',
          loopId: id,
          actorJid,
        })
        setPayload(result.snapshot)
      } else if (tab === 'heal') {
        const [pending, snapshot] = await Promise.all([
          api.call<{ pending: unknown }>({ op: 'healer.pending', loopId: id, actorJid }),
          api.call<{ snapshot: unknown }>({ op: 'network.snapshot', loopId: id, actorJid }),
        ])
        setHealPlan(pending.pending)
        setPayload(snapshot.snapshot)
      } else if (tab === 'control') {
        const [asp, loop] = await Promise.all([
          api.call<{ status: unknown }>({ op: 'asp.status', actorJid }),
          api.call<{ loop?: unknown; admin?: unknown }>({ op: 'loop.get', loopId: id, actorJid }),
        ])
        const admin = (loop as { admin?: {
          control?: {
            allowRemotePeers?: boolean
            canHealAuto?: boolean
            healAutoAllow?: string[]
          }
          deputies?: string[]
          deputyGrants?: Record<string, string[]>
        } }).admin
        if (admin?.control?.allowRemotePeers !== undefined) {
          setAllowRemotePeers(Boolean(admin.control.allowRemotePeers))
        }
        if (admin?.control?.canHealAuto !== undefined) {
          setCanHealAuto(Boolean(admin.control.canHealAuto))
        }
        if (admin?.control?.healAutoAllow) {
          setHealAutoAllow([...admin.control.healAutoAllow])
        }
        setPayload({ asp: asp.status, admin: admin ?? null })
      } else {
        const result = await api.call<{ plan: unknown }>({
          op: 'plan.get',
          loopId: id,
          actorJid,
        })
        setPayload(result.plan)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setBusy(false)
    }
  }, [actorJid, api, loopId, tab, t])

  useEffect(() => {
    if (loopId.trim()) void refresh()
  }, [loopId, tab, refresh])

  const runOp = async (fn: (id: string) => Promise<void>) => {
    const id = requireLoop()
    if (!id) return
    setBusy(true)
    setError(null)
    try {
      await fn(id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'))
    } finally {
      setBusy(false)
    }
  }

  const tabs: CollabTab[] = ['vision', 'roster', 'network', 'heal', 'plan', 'control']

  return (
    <section className="workflow-collab-panel">
      <div className="workflow-collab-head">
        <h4>{t('collabPanelTitle')}</h4>
        <button
          type="button"
          className="workflow-btn small"
          disabled={busy || !loopId.trim()}
          onClick={() => void refresh()}
        >
          {t('collabRefresh')}
        </button>
      </div>

      <label className="workflow-form-group">
        <span>{t('collabLoopId')}</span>
        <input
          type="text"
          className="workflow-input"
          value={loopId}
          onChange={(event) => setLoopId(event.target.value)}
          placeholder="loop-uuid"
        />
      </label>

      <div className="workflow-collab-tabs" role="tablist">
        {tabs.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={tab === entry}
            className={`workflow-btn small${tab === entry ? ' primary' : ''}`}
            onClick={() => setTab(entry)}
          >
            {tabLabel(entry, t)}
          </button>
        ))}
      </div>

      <div className="workflow-collab-actions">
        <label className="workflow-form-group">
          <span>{t('collabPeerJid')}</span>
          <input
            type="text"
            className="workflow-input"
            value={inviteJid}
            onChange={(event) => setInviteJid(event.target.value)}
          />
        </label>
        <label className="workflow-form-group">
          <span>{t('collabPeerSlot')}</span>
          <input
            type="text"
            className="workflow-input"
            value={inviteSlot}
            onChange={(event) => setInviteSlot(event.target.value)}
          />
        </label>
        <label className="workflow-form-group">
          <span>{t('collabPeerDid')}</span>
          <input
            type="text"
            className="workflow-input"
            value={inviteDid}
            onChange={(event) => setInviteDid(event.target.value)}
            placeholder="did:dsh:… (optional)"
          />
        </label>
        <div className="workflow-collab-action-row">
          <button
            type="button"
            className="workflow-btn small"
            disabled={busy}
            onClick={() => void runOp(async (id) => {
              if (!inviteJid.trim() || !inviteSlot.trim()) {
                throw new Error(`${t('collabPeerJid')} / ${t('collabPeerSlot')} required`)
              }
              await api.call({
                op: 'membership.join',
                loopId: id,
                actorJid,
                jid: inviteJid.trim(),
                slot: inviteSlot.trim(),
                ...(inviteDid.trim() ? { did: inviteDid.trim() } : {}),
              })
            })}
          >
            {t('collabJoin')}
          </button>
          <button
            type="button"
            className="workflow-btn small"
            disabled={busy || !inviteJid.trim()}
            onClick={() => void runOp(async (id) => {
              await api.call({
                op: 'membership.leave',
                loopId: id,
                actorJid,
                jid: inviteJid.trim(),
              })
            })}
          >
            {t('collabLeave')}
          </button>
          <button
            type="button"
            className="workflow-btn small"
            disabled={busy}
            onClick={() => void runOp(async (id) => {
              if (!inviteJid.trim() || !inviteSlot.trim()) {
                throw new Error(`${t('collabPeerJid')} / ${t('collabPeerSlot')} required`)
              }
              await api.call({
                op: 'membership.invite',
                loopId: id,
                actorJid,
                jid: inviteJid.trim(),
                slot: inviteSlot.trim(),
              })
            })}
          >
            {t('collabInvite')}
          </button>
          <button
            type="button"
            className="workflow-btn small danger"
            disabled={busy || !kickJid.trim()}
            onClick={() => void runOp(async (id) => {
              await api.call({
                op: 'membership.kick',
                loopId: id,
                actorJid,
                jid: kickJid.trim(),
              })
            })}
          >
            {t('collabKick')}
          </button>
        </div>
        <label className="workflow-form-group">
          <span>{t('collabKick')}</span>
          <input
            type="text"
            className="workflow-input"
            value={kickJid}
            onChange={(event) => setKickJid(event.target.value)}
          />
        </label>
      </div>

      {tab === 'heal' && (
        <div className="workflow-collab-action-row">
          <button
            type="button"
            className="workflow-btn small"
            disabled={busy}
            onClick={() => void runOp(async (id) => {
              const result = await api.call<{ plan: unknown }>({
                op: 'healer.evaluate',
                loopId: id,
                actorJid,
              })
              setHealPlan(result.plan)
            })}
          >
            {t('collabEvaluateHeal')}
          </button>
          <button
            type="button"
            className="workflow-btn small primary"
            disabled={busy || !healPlan}
            onClick={() => void runOp(async (id) => {
              await api.call({
                op: 'healer.apply',
                loopId: id,
                actorJid,
                healPlan,
              })
              setHealPlan(null)
            })}
          >
            {t('collabApplyHeal')}
          </button>
        </div>
      )}

      {tab === 'plan' && (
        <>
          <label className="workflow-form-group">
            <span>{t('collabEvaluatePlan')}</span>
            <input
              type="text"
              className="workflow-input"
              value={planHint}
              onChange={(event) => setPlanHint(event.target.value)}
              placeholder="hint (optional)"
            />
          </label>
          <button
            type="button"
            className="workflow-btn small"
            disabled={busy}
            onClick={() => void runOp(async (id) => {
              await api.call({
                op: 'plan.evaluate',
                loopId: id,
                actorJid,
                ...(planHint.trim() ? { hint: planHint.trim() } : {}),
              })
            })}
          >
            {t('collabEvaluatePlan')}
          </button>
        </>
      )}

      {tab === 'control' && (
        <div className="workflow-collab-control">
          <div className="workflow-collab-action-row">
            <button
              type="button"
              className="workflow-btn small"
              disabled={busy}
              onClick={() => void runOp(async (id) => {
                await api.call({ op: 'asp.setMode', loopId: id, actorJid, aspMode: 'in-process' })
              })}
            >
              {t('collabAspInProcess')}
            </button>
            <button
              type="button"
              className="workflow-btn small"
              disabled={busy}
              onClick={() => void runOp(async (id) => {
                await api.call({ op: 'asp.setMode', loopId: id, actorJid, aspMode: 'disconnected' })
              })}
            >
              {t('collabAspDisconnected')}
            </button>
            <button
              type="button"
              className="workflow-btn small"
              disabled={busy || !aspEndpoint.trim()}
              onClick={() => void runOp(async (id) => {
                await api.call({
                  op: 'asp.setMode',
                  loopId: id,
                  actorJid,
                  aspMode: 'external',
                  aspEndpoint: aspEndpoint.trim(),
                })
              })}
            >
              {t('collabAspExternal')}
            </button>
          </div>
          <label className="workflow-form-group">
            <span>{t('collabAspEndpoint')}</span>
            <input
              type="text"
              className="workflow-input"
              value={aspEndpoint}
              onChange={(event) => setAspEndpoint(event.target.value)}
              placeholder="127.0.0.1:9700"
            />
          </label>
          <label className="workflow-form-group">
            <span>
              <input
                type="checkbox"
                checked={allowRemotePeers}
                onChange={(event) => setAllowRemotePeers(event.target.checked)}
              />
              {' '}
              {t('collabAllowRemotePeers')}
            </span>
          </label>
          <label className="workflow-form-group">
            <span>
              <input
                type="checkbox"
                checked={canHealAuto}
                onChange={(event) => setCanHealAuto(event.target.checked)}
              />
              {' '}
              {t('collabHealAuto')}
            </span>
          </label>
          <fieldset className="workflow-form-group">
            <legend>{t('collabHealAutoAllow')}</legend>
            {HEAL_AUTO_OPTIONS.map((action) => (
              <label key={action} style={{ display: 'block' }}>
                <input
                  type="checkbox"
                  checked={healAutoAllow.includes(action)}
                  onChange={(event) => {
                    setHealAutoAllow((prev) => (
                      event.target.checked
                        ? [...new Set([...prev, action])]
                        : prev.filter((entry) => entry !== action)
                    ))
                  }}
                />
                {' '}
                {action}
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            className="workflow-btn small primary"
            disabled={busy}
            onClick={() => void runOp(async (id) => {
              await api.call({
                op: 'admin.updateControl',
                loopId: id,
                actorJid,
                control: {
                  allowRemotePeers,
                  canHealAuto,
                  healAutoAllow: healAutoAllow as Array<'nudge_rejoin' | 'reassign_goal' | 'invite'>,
                },
              })
            })}
          >
            {t('collabSaveControl')}
          </button>
          <label className="workflow-form-group">
            <span>{t('collabDeputyJid')}</span>
            <input
              type="text"
              className="workflow-input"
              value={deputyJid}
              onChange={(event) => setDeputyJid(event.target.value)}
              placeholder="deputy@desktop.local/control"
            />
          </label>
          <label className="workflow-form-group">
            <span>{t('collabDeputyGrants')}</span>
            <input
              type="text"
              className="workflow-input"
              value={deputyGrantsText}
              onChange={(event) => setDeputyGrantsText(event.target.value)}
              placeholder="read,invite,kick"
            />
          </label>
          <button
            type="button"
            className="workflow-btn small"
            disabled={busy || !deputyJid.trim()}
            onClick={() => void runOp(async (id) => {
              const grants = deputyGrantsText
                .split(/[,\s]+/)
                .map((entry) => entry.trim())
                .filter(Boolean) as Array<
                'invite' | 'kick' | 'reassign' | 'pause' | 'spawnBranch'
                | 'healApply' | 'healEvaluate' | 'planEvaluate' | 'read'
              >
              const loop = await api.call<{ admin?: {
                deputies?: string[]
                deputyGrants?: Record<string, string[]>
              } }>({ op: 'loop.get', loopId: id, actorJid })
              const deputies = [...new Set([...(loop.admin?.deputies ?? []), deputyJid.trim()])]
              const deputyGrants = {
                ...(loop.admin?.deputyGrants ?? {}),
                [deputyJid.trim()]: grants.length > 0 ? grants : ['read'],
              }
              await api.call({
                op: 'admin.updateControl',
                loopId: id,
                actorJid,
                deputies,
                deputyGrants,
              })
            })}
          >
            {t('collabSaveDeputy')}
          </button>
        </div>
      )}

      {error && <p className="workflow-error">{error}</p>}

      <pre className="workflow-collab-json">
        {payload === null || payload === undefined
          ? '—'
          : JSON.stringify(payload, null, 2)}
      </pre>
      {tab === 'heal' && healPlan != null && (
        <pre className="workflow-collab-json workflow-collab-json-pending">
          pending heal:
          {'\n'}
          {JSON.stringify(healPlan, null, 2)}
        </pre>
      )}
    </section>
  )
}
