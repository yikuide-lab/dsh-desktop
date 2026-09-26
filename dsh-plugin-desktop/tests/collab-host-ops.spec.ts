/**
 * Collab Host HTTP ops — admin auth and loop.start persistence.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeCollabOp } from '../src/collab-host/ops.ts'
import { DEFAULT_ADMIN_JID } from '../src/collab-host/auth.ts'
import { resetCollabBusForTests } from '../src/collab-host/bus.ts'
import { readRosterJson, writeRosterJson } from 'dsh-plugin-workflow/collab'

describe('collab host ops', () => {
  let dshHome: string
  const previousHome = process.env.DSH_HOME

  beforeEach(() => {
    dshHome = mkdtempSync(join(tmpdir(), 'collab-host-'))
    process.env.DSH_HOME = dshHome
    resetCollabBusForTests()
  })

  afterEach(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(dshHome, { recursive: true, force: true })
  })

  it('loop.start creates collab disk files under DSH_HOME', async () => {
    const result = await executeCollabOp({
      op: 'loop.start',
      actorJid: DEFAULT_ADMIN_JID,
      workflowName: 'demo-collab',
    })
    expect(result).toMatchObject({ ok: true })
    const loopId = (result as { loop: { loopId: string } }).loop.loopId
    const loopDir = join(dshHome, 'collab', loopId)
    expect(existsSync(join(loopDir, 'loop.json'))).toBe(true)
    expect(existsSync(join(loopDir, 'admin.json'))).toBe(true)
    expect(existsSync(join(loopDir, 'roster.json'))).toBe(true)
    expect(existsSync(join(loopDir, 'vision.json'))).toBe(true)
    const loopRaw = readFileSync(join(loopDir, 'loop.json'), 'utf8')
    expect(loopRaw).toContain('demo-collab')
  })

  it('rejects admin write without actorJid', async () => {
    const started = await executeCollabOp({
      op: 'loop.start',
      actorJid: DEFAULT_ADMIN_JID,
      workflowName: 'auth-test',
    })
    const loopId = (started as { loop: { loopId: string } }).loop.loopId

    const denied = await executeCollabOp({
      op: 'membership.invite',
      loopId,
      slot: 'slot-a',
      role: 'reviewer',
    })
    expect(denied).toEqual({
      ok: false,
      error: 'actorJid or capToken is required',
    })

    const ok = await executeCollabOp({
      op: 'membership.invite',
      loopId,
      actorJid: DEFAULT_ADMIN_JID,
      slot: 'slot-a',
      role: 'reviewer',
    })
    expect((ok as { ok: boolean }).ok).toBe(true)
  })

  it('plan.evaluate from hint stores heuristic task plan without LLM', async () => {
    const started = await executeCollabOp({
      op: 'loop.start',
      actorJid: DEFAULT_ADMIN_JID,
      workflowName: 'plan-hint',
    })
    const loopId = (started as { loop: { loopId: string } }).loop.loopId

    const evaluated = await executeCollabOp({
      op: 'plan.evaluate',
      loopId,
      actorJid: DEFAULT_ADMIN_JID,
      hint: 'Build feature X',
    })
    expect(evaluated).toMatchObject({
      ok: true,
      source: 'heuristic',
      plan: {
        loopId,
        rootGoal: 'Build feature X',
        subtasks: expect.any(Array),
      },
    })
    expect((evaluated as { plan: { subtasks: unknown[] } }).plan.subtasks).toHaveLength(3)
  })

  it('healer.evaluate uses heuristic when Host context is absent', async () => {
    const started = await executeCollabOp({
      op: 'loop.start',
      actorJid: DEFAULT_ADMIN_JID,
      workflowName: 'heal-test',
    })
    const loopId = (started as { loop: { loopId: string } }).loop.loopId

    await executeCollabOp({
      op: 'membership.invite',
      loopId,
      actorJid: DEFAULT_ADMIN_JID,
      slot: 'slot-a',
      role: 'implementer',
    })
    await executeCollabOp({
      op: 'membership.join',
      loopId,
      actorJid: DEFAULT_ADMIN_JID,
      jid: 'session@desktop.local/ses-off',
      slot: 'slot-a',
    })

    const roster = await readRosterJson(loopId)
    roster.members = roster.members.map((member) => ({
      ...member,
      show: 'OFFLINE' as const,
    }))
    await writeRosterJson(loopId, roster)

    const healed = await executeCollabOp({
      op: 'healer.evaluate',
      loopId,
      actorJid: DEFAULT_ADMIN_JID,
    })
    expect(healed).toMatchObject({ ok: true, source: 'heuristic' })
    const plan = (healed as { plan: { actions: Array<{ type: string }> } }).plan
    expect(plan.actions.some((action) => action.type === 'nudge_rejoin')).toBe(true)
  })

  it('asp.status reports in-process bridge by default', async () => {
    const status = await executeCollabOp({ op: 'asp.status' })
    expect(status).toMatchObject({
      ok: true,
      status: { mode: 'in-process' },
    })
  })

  it('asp.setMode switches to disconnected', async () => {
    const switched = await executeCollabOp({
      op: 'asp.setMode',
      actorJid: DEFAULT_ADMIN_JID,
      aspMode: 'disconnected',
    })
    expect(switched).toMatchObject({
      ok: true,
      status: { mode: 'disconnected' },
    })
    const rejected = await executeCollabOp({
      op: 'asp.setMode',
      actorJid: DEFAULT_ADMIN_JID,
      aspMode: 'external',
    })
    expect(rejected).toEqual({
      ok: false,
      error: 'ASP external bridge requires endpoint ([tls://]host:port)',
    })
    const external = await executeCollabOp({
      op: 'asp.setMode',
      actorJid: DEFAULT_ADMIN_JID,
      aspMode: 'external',
      aspEndpoint: '127.0.0.1:9700',
    })
    expect(external).toMatchObject({
      ok: true,
      status: { mode: 'external', endpoint: '127.0.0.1:9700', codec: 'protobuf' },
    })
    await executeCollabOp({
      op: 'asp.setMode',
      actorJid: DEFAULT_ADMIN_JID,
      aspMode: 'in-process',
    })
  })

  it('deputy with invite grant can invite but not kick', async () => {
    const started = await executeCollabOp({
      op: 'loop.start',
      actorJid: DEFAULT_ADMIN_JID,
      workflowName: 'deputy-acl',
    })
    const loopId = (started as { loop: { loopId: string } }).loop.loopId
    const deputyJid = 'agent@desktop.local/deputy-1'

    await executeCollabOp({
      op: 'admin.updateControl',
      loopId,
      actorJid: DEFAULT_ADMIN_JID,
      deputies: [deputyJid],
      deputyGrants: { [deputyJid]: ['invite', 'read'] },
    })

    const invited = await executeCollabOp({
      op: 'membership.invite',
      loopId,
      actorJid: deputyJid,
      slot: 'slot-deputy',
      role: 'reviewer',
    })
    expect((invited as { ok: boolean }).ok).toBe(true)

    await executeCollabOp({
      op: 'membership.invite',
      loopId,
      actorJid: DEFAULT_ADMIN_JID,
      slot: 'slot-kick',
      role: 'implementer',
    })
    await executeCollabOp({
      op: 'membership.join',
      loopId,
      actorJid: DEFAULT_ADMIN_JID,
      jid: 'session@desktop.local/ses-kick',
      slot: 'slot-kick',
    })

    const deniedKick = await executeCollabOp({
      op: 'membership.kick',
      loopId,
      actorJid: deputyJid,
      jid: 'session@desktop.local/ses-kick',
    })
    expect(deniedKick).toEqual({
      ok: false,
      error: 'forbidden: deputy grant "kick" required',
    })
  })

  it('admin.updateControl persists healAutoAllow', async () => {
    const started = await executeCollabOp({
      op: 'loop.start',
      actorJid: DEFAULT_ADMIN_JID,
      workflowName: 'heal-control',
    })
    const loopId = (started as { loop: { loopId: string } }).loop.loopId

    const updated = await executeCollabOp({
      op: 'admin.updateControl',
      loopId,
      actorJid: DEFAULT_ADMIN_JID,
      control: {
        canHealAuto: true,
        healAutoAllow: ['nudge_rejoin'],
      },
    })
    expect(updated).toMatchObject({
      ok: true,
      admin: {
        control: {
          canHealAuto: true,
          healAutoAllow: ['nudge_rejoin'],
        },
      },
    })
  })

  it('plan.spawnBranch writes branch YAML under DSH_HOME', async () => {
    const started = await executeCollabOp({
      op: 'loop.start',
      actorJid: DEFAULT_ADMIN_JID,
      workflowName: 'branch-test',
    })
    const loopId = (started as { loop: { loopId: string } }).loop.loopId

    const spawned = await executeCollabOp({
      op: 'plan.spawnBranch',
      loopId,
      actorJid: DEFAULT_ADMIN_JID,
      branchId: 'branch-1',
      hint: 'Repair failing step',
    })
    expect(spawned).toMatchObject({ ok: true })
    const yamlPath = join(dshHome, 'collab', loopId, 'branches', 'branch-1.yaml')
    expect(existsSync(yamlPath)).toBe(true)
    const yaml = readFileSync(yamlPath, 'utf8')
    expect(yaml).toContain('apiVersion: workflow-wise/v1')
    expect(yaml).toContain('Repair failing step')
  })
})
