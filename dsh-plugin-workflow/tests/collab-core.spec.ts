import { describe, expect, it } from 'vitest'
import {
  parseJid,
  formatJid,
  isLocalDesktopJid,
  peerKindFromJid,
  joinMember,
  leaveMember,
  kickMember,
  rejoinMember,
  heartbeatMember,
  tick,
  DEFAULT_STABILITY,
  issueCapToken,
  verifyCapToken,
  parseHealPlan,
  validateHealPlan,
  applyHealActions,
  parseTaskPlan,
  validateTaskPlan,
  applyTaskPlanPriority,
  type LoopRoster,
  type CollabVision,
} from '../src/collab/index.ts'

describe('collab JID', () => {
  it('parses and formats ASP-shaped desktop.local JIDs', () => {
    expect(parseJid('admin@desktop.local/control')).toEqual({
      node: 'admin',
      domain: 'desktop.local',
      resource: 'control',
      bare: 'admin@desktop.local',
      full: 'admin@desktop.local/control',
    })
    expect(parseJid('session@desktop.local/ses-1')).toMatchObject({
      node: 'session',
      resource: 'ses-1',
    })
    expect(formatJid('agent', 'desktop.local', 'a1')).toBe('agent@desktop.local/a1')
    expect(formatJid('workflow', 'desktop.local', 'demo')).toBe('workflow@desktop.local/demo')
    expect(formatJid('awf', 'desktop.local', 'wf-42')).toBe('awf@desktop.local/wf-42')
    expect(isLocalDesktopJid('session@desktop.local/x')).toBe(true)
    expect(isLocalDesktopJid('session@other.local/x')).toBe(false)
    expect(peerKindFromJid('session@desktop.local/x')).toBe('session')
    expect(peerKindFromJid('agent@desktop.local/x')).toBe('agent')
    expect(peerKindFromJid('workflow@desktop.local/x')).toBe('workflow')
    expect(peerKindFromJid('awf@desktop.local/x')).toBe('awf')
    expect(peerKindFromJid('admin@desktop.local/control')).toBe('admin')
  })
})

describe('collab membership lifecycle', () => {
  const loopId = 'loop-1'
  const slot = 'slot-a'
  const jid = 'session@desktop.local/ses-1'

  function baseRoster(): LoopRoster {
    return {
      loopId,
      updatedAt: new Date(0).toISOString(),
      members: [{
        kind: 'session',
        slot,
        role: 'implementer',
        lifecycle: 'vacant',
        epoch: 0,
      }],
    }
  }

  function baseVision(): CollabVision {
    return {
      loopId,
      threadId: loopId,
      goals: [{
        id: 'g1',
        title: 'Implement feature',
        status: 'open',
        ownerJid: jid,
        slot,
      }],
      facts: [],
      artifacts: [],
      updatedAt: new Date(0).toISOString(),
    }
  }

  it('join → heartbeat miss → offline → orphaned → rejoin resume', () => {
    const t0 = Date.parse('2026-01-01T00:00:00.000Z')
    const joined = joinMember({
      roster: baseRoster(),
      vision: baseVision(),
      jid,
      slot,
      nowMs: t0,
    })
    expect(joined.roster.members[0].lifecycle).toBe('active')
    expect(joined.roster.members[0].show).toBe('ONLINE')
    expect(joined.roster.members[0].epoch).toBe(1)

    const hb = heartbeatMember({ roster: joined.roster, jid, nowMs: t0 + 1_000 })
    expect(hb.roster.members[0].lastSeenAt).toBeDefined()

    const lastHbMs = t0 + 1_000
    const away = tick(hb.roster, joined.vision, lastHbMs + DEFAULT_STABILITY.heartbeatMs + 1, DEFAULT_STABILITY)
    expect(away.roster.members[0].show).toBe('AWAY')

    const offline = tick(away.roster, away.vision, lastHbMs + DEFAULT_STABILITY.offlineGraceMs + 1, DEFAULT_STABILITY)
    expect(offline.roster.members[0].show).toBe('OFFLINE')
    expect(offline.events.some((e) => e.type === 'member.offline')).toBe(true)
    expect(offline.vision?.goals[0].status).toBe('orphaned')
    expect(offline.vision?.goals[0].ownerJid).toBeUndefined()

    const rejoined = rejoinMember({
      roster: offline.roster,
      vision: offline.vision,
      jid,
      slot,
      mode: 'resume',
      nowMs: lastHbMs + DEFAULT_STABILITY.offlineGraceMs + 5_000,
    })
    expect(rejoined.roster.members[0].show).toBe('ONLINE')
    expect(rejoined.roster.members[0].epoch).toBe(2)
    expect(rejoined.vision?.goals[0].status).toBe('open')
    expect(rejoined.vision?.goals[0].ownerJid).toBe(jid)
  })
})

describe('collab CapToken epoch revoke', () => {
  const secret = Buffer.from('test-secret-key-32-bytes-long!!')

  it('leave and kick bump epoch so prior token verify fails', () => {
    const roster: LoopRoster = {
      loopId: 'loop-1',
      updatedAt: new Date().toISOString(),
      members: [{
        kind: 'session',
        slot: 's1',
        lifecycle: 'active',
        jid: 'session@desktop.local/a',
        show: 'ONLINE',
        epoch: 1,
      }],
    }
    const token = issueCapToken({
      loopId: 'loop-1',
      subject_jid: 'session@desktop.local/a',
      permissions: ['vision:read'],
      epoch: 1,
      secret,
    })
    expect(verifyCapToken({
      token,
      secret,
      loopId: 'loop-1',
      subject_jid: 'session@desktop.local/a',
      expectedEpoch: 1,
    })).toBe(true)

    const left = leaveMember({ roster, jid: 'session@desktop.local/a' })
    expect(left.roster.members[0].epoch).toBe(2)
    expect(verifyCapToken({
      token,
      secret,
      loopId: 'loop-1',
      subject_jid: 'session@desktop.local/a',
      expectedEpoch: left.roster.members[0].epoch,
    })).toBe(false)

    const roster2: LoopRoster = {
      ...roster,
      members: [{ ...roster.members[0], lifecycle: 'active', epoch: 3 }],
    }
    const token2 = issueCapToken({
      loopId: 'loop-1',
      subject_jid: 'session@desktop.local/a',
      permissions: ['vision:read'],
      epoch: 3,
      secret,
    })
    const kicked = kickMember({ roster: roster2, jid: 'session@desktop.local/a' })
    expect(kicked.roster.members[0].epoch).toBe(4)
    expect(verifyCapToken({
      token: token2,
      secret,
      loopId: 'loop-1',
      subject_jid: 'session@desktop.local/a',
      expectedEpoch: kicked.roster.members[0].epoch,
    })).toBe(false)
  })
})

describe('collab HealPlan schema', () => {
  it('rejects invalid heal plans', () => {
    expect(() => validateHealPlan(parseHealPlan({ loopId: '', at: 'x', healthScore: 10, findings: [], actions: [] })))
      .toThrow(/loopId/)
    expect(() => validateHealPlan(parseHealPlan({
      loopId: 'l1',
      at: '2026-01-01T00:00:00.000Z',
      healthScore: 200,
      findings: [],
      actions: [],
    }))).toThrow(/healthScore/)
    expect(() => validateHealPlan(parseHealPlan({
      loopId: 'l1',
      at: '2026-01-01T00:00:00.000Z',
      healthScore: 50,
      findings: [{ code: 'x', detail: 'd', severity: 'fatal' }],
      actions: [],
    }))).toThrow(/severity/)
    expect(() => validateHealPlan(parseHealPlan({
      loopId: 'l1',
      at: '2026-01-01T00:00:00.000Z',
      healthScore: 50,
      findings: [],
      actions: [{ type: 'reassign_goal', goalId: 'g1' }],
    }))).toThrow(/toJid or toSlot/)
  })

  it('applyHealActions returns proposed mutations without auto gating', () => {
    const plan = parseHealPlan({
      loopId: 'l1',
      at: '2026-01-01T00:00:00.000Z',
      healthScore: 40,
      findings: [],
      actions: [
        { type: 'nudge_rejoin', jid: 'session@desktop.local/a' },
        { type: 'invite', slot: 'slot-b', role: 'reviewer', reason: 'need help' },
      ],
    })
    validateHealPlan(plan)
    const roster: LoopRoster = {
      loopId: 'l1',
      updatedAt: new Date().toISOString(),
      members: [],
    }
    const applied = applyHealActions({ plan, roster })
    expect(applied.mutations.map((m) => m.type)).toEqual(['nudge_rejoin', 'invite'])
    expect(applied.roster?.members.some((m) => m.slot === 'slot-b' && m.lifecycle === 'vacant')).toBe(true)
  })
})

describe('collab TaskPlan priority', () => {
  const roster: LoopRoster = {
    loopId: 'loop-1',
    updatedAt: new Date().toISOString(),
    members: [{
      kind: 'agent',
      slot: 'slot-a',
      lifecycle: 'active',
      jid: 'agent@desktop.local/a1',
      show: 'ONLINE',
      epoch: 1,
    }],
  }

  it('applies assign > invite > branch hint > open goal', () => {
    const plan = parseTaskPlan({
      loopId: 'loop-1',
      rootGoal: 'root',
      subtasks: [
        { id: 't-assign', title: 'Assigned', assignToJid: 'agent@desktop.local/a1' },
        { id: 't-invite', title: 'Invite', inviteSlot: 'slot-b', preferredRole: 'reviewer' },
        { id: 't-branch', title: 'Branch', branchHint: 'repair' },
        { id: 't-open', title: 'Open only' },
      ],
    })
    validateTaskPlan(plan)
    const applied = applyTaskPlanPriority({ plan, roster })
    expect(applied.mutations.map((m) => m.type)).toEqual([
      'assign_goal',
      'invite',
      'spawn_branch',
      'open_goal',
    ])
    const assignGoal = applied.vision?.goals.find((g) => g.id === 't-assign')
    expect(assignGoal?.ownerJid).toBe('agent@desktop.local/a1')
    expect(applied.roster?.members.some((m) => m.slot === 'slot-b')).toBe(true)
    expect(applied.branches?.some((b) => b.goalIds.includes('t-branch'))).toBe(true)
    const openGoal = applied.vision?.goals.find((g) => g.id === 't-open')
    expect(openGoal?.status).toBe('open')
    expect(openGoal?.ownerJid).toBeUndefined()
  })

  it('prefers assign over invite when both would apply conceptually', () => {
    const plan = parseTaskPlan({
      loopId: 'loop-1',
      rootGoal: 'root',
      subtasks: [
        { id: 't1', title: 'Both', assignToJid: 'agent@desktop.local/a1' },
      ],
    })
    validateTaskPlan(plan)
    const applied = applyTaskPlanPriority({ plan, roster })
    expect(applied.mutations[0]?.type).toBe('assign_goal')
  })
})
