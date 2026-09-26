/**
 * runCollabPeerStep remote session/agent gate — V2 controlled path.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCollabPeerStep } from '../src/desktop-workflow-executor.ts'
import { executeCollabOp } from '../src/collab-host/ops.ts'
import { DEFAULT_ADMIN_JID } from '../src/collab-host/auth.ts'
import { resetCollabBusForTests } from '../src/collab-host/bus.ts'
import type { Step } from 'dsh-plugin-workflow/engine'

const services = {}

function sessionStep(jid: string): Step {
  return {
    id: 'peer-1',
    type: 'collab_peer',
    peer: { kind: 'session', jid, open: false },
  } as Step
}

describe('runCollabPeerStep remote gate', () => {
  let dshHome: string
  const previousHome = process.env.DSH_HOME

  beforeEach(() => {
    dshHome = mkdtempSync(join(tmpdir(), 'collab-remote-'))
    process.env.DSH_HOME = dshHome
    resetCollabBusForTests()
  })

  afterEach(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(dshHome, { recursive: true, force: true })
  })

  it('allows desktop.local session peers', async () => {
    const outcome = await runCollabPeerStep(
      services,
      sessionStep('session@desktop.local/ses-1'),
      { params: {}, env: {} },
      '/tmp',
      AbortSignal.timeout(5_000),
    )
    expect(outcome.ok).toBe(true)
  })

  it('rejects remote domain when allowRemotePeers is false', async () => {
    const outcome = await runCollabPeerStep(
      services,
      sessionStep('session@remote.example/ses-1'),
      { params: {}, env: {} },
      '/tmp',
      AbortSignal.timeout(5_000),
    )
    expect(outcome.ok).toBe(false)
    expect((outcome.output as { code?: string })?.code).toBe('REMOTE_PEER_DISABLED')
  })

  it('returns REMOTE_PEER_ASP_REQUIRED when allowRemotePeers is true but bridge is in-process', async () => {
    const started = await executeCollabOp({
      op: 'loop.start',
      actorJid: DEFAULT_ADMIN_JID,
      workflowName: 'remote-gate',
    })
    const loopId = (started as { loop: { loopId: string } }).loop.loopId
    await executeCollabOp({
      op: 'admin.updateControl',
      loopId,
      actorJid: DEFAULT_ADMIN_JID,
      control: { allowRemotePeers: true },
    })

    const outcome = await runCollabPeerStep(
      services,
      sessionStep('session@remote.example/ses-1'),
      { params: { COLLAB_LOOP_ID: loopId }, env: {} },
      '/tmp',
      AbortSignal.timeout(5_000),
    )
    expect(outcome.ok).toBe(false)
    expect((outcome.output as { code?: string })?.code).toBe('REMOTE_PEER_ASP_REQUIRED')
  })
})
