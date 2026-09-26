import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WorkflowLocaleKey } from './locales-workflow.js'
import {
  createDesktopCollabApi,
  DEFAULT_COLLAB_ACTOR_JID,
} from './collab-api.js'

type CollabTab = 'vision' | 'roster' | 'network' | 'heal' | 'plan'

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
  }
}

/** Minimal Collab Loop control surface (Vision / Roster / Network / Heal / Task Plan). */
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
  const [kickJid, setKickJid] = useState('')
  const [planHint, setPlanHint] = useState('')
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

  const tabs: CollabTab[] = ['vision', 'roster', 'network', 'heal', 'plan']

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

      {error && <p className="workflow-error">{error}</p>}

      <pre className="workflow-collab-json">
        {payload === null || payload === undefined
          ? '—'
          : JSON.stringify(payload, null, 2)}
      </pre>
      {tab === 'heal' && healPlan && (
        <pre className="workflow-collab-json workflow-collab-json-pending">
          pending heal:
          {'\n'}
          {JSON.stringify(healPlan, null, 2)}
        </pre>
      )}
    </section>
  )
}
