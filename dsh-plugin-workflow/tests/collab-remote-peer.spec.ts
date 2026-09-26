/**
 * Remote session/agent peer gate — V2 controlled path without fake execution.
 */

import { describe, expect, it } from 'vitest'
import {
  isRemoteDomainJid,
  isRemoteNodeHintJid,
  resolveRemoteSessionAgentPeer,
} from '../src/collab/remote-peer.js'

describe('remote session/agent peer gate', () => {
  it('allows desktop.local session/agent JIDs', () => {
    expect(resolveRemoteSessionAgentPeer({
      jid: 'session@desktop.local/ses-1',
      kind: 'session',
      allowRemotePeers: false,
      aspBridgeMode: 'in-process',
    })).toEqual({ ok: true })
  })

  it('rejects remote domain when allowRemotePeers is false', () => {
    const decision = resolveRemoteSessionAgentPeer({
      jid: 'session@remote.example/ses-1',
      kind: 'session',
      allowRemotePeers: false,
      aspBridgeMode: 'in-process',
    })
    expect(decision.ok).toBe(false)
    expect(decision.code).toBe('REMOTE_PEER_DISABLED')
  })

  it('requires external AspBridge when allowRemotePeers is true', () => {
    const decision = resolveRemoteSessionAgentPeer({
      jid: 'agent@other.host/agent-1',
      kind: 'agent',
      allowRemotePeers: true,
      aspBridgeMode: 'in-process',
    })
    expect(decision.ok).toBe(false)
    expect(decision.code).toBe('REMOTE_PEER_ASP_REQUIRED')
  })

  it('returns ASP_BRIDGE_DISCONNECTED when external mode is set but TCP pending', () => {
    const decision = resolveRemoteSessionAgentPeer({
      jid: 'agent@other.host/agent-1',
      kind: 'agent',
      allowRemotePeers: true,
      aspBridgeMode: 'external',
    })
    expect(decision.ok).toBe(false)
    expect(decision.code).toBe('ASP_BRIDGE_DISCONNECTED')
  })

  it('detects remote domain and node hints', () => {
    expect(isRemoteDomainJid('session@remote.example/x')).toBe(true)
    expect(isRemoteDomainJid('session@desktop.local/x')).toBe(false)
    expect(isRemoteNodeHintJid('remote.session@desktop.local/x')).toBe(true)
    expect(isRemoteNodeHintJid('session@desktop.local/x')).toBe(false)
  })
})
