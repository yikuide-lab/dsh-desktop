/** Remote session/agent peer gate — V2 AspBridge path (no fake remote execution). */

import type { AspBridgeMode } from './bus.js'
import { isLocalDesktopJid, parseJid } from './jid.js'
import type { PeerKind } from './types.js'

export type RemotePeerErrorCode =
  | 'REMOTE_PEER_DISABLED'
  | 'REMOTE_PEER_ASP_REQUIRED'
  | 'ASP_BRIDGE_DISCONNECTED'

export interface RemotePeerDecision {
  ok: boolean
  code?: RemotePeerErrorCode
  error?: string
}

export function isRemoteDomainJid(jid: string): boolean {
  try {
    return !isLocalDesktopJid(jid)
  } catch {
    return true
  }
}

/** Resolve whether a session/agent peer with a non-local JID may proceed. */
export function resolveRemoteSessionAgentPeer(input: {
  jid: string
  kind: PeerKind
  allowRemotePeers: boolean
  aspBridgeMode: AspBridgeMode
}): RemotePeerDecision {
  if (input.kind !== 'session' && input.kind !== 'agent') {
    return { ok: true }
  }
  if (!isRemoteDomainJid(input.jid)) {
    return { ok: true }
  }
  if (!input.allowRemotePeers) {
    return {
      ok: false,
      code: 'REMOTE_PEER_DISABLED',
      error: `remote ${input.kind} peer rejected: ${input.jid} (allowRemotePeers is false)`,
    }
  }
  if (input.aspBridgeMode !== 'external') {
    return {
      ok: false,
      code: 'REMOTE_PEER_ASP_REQUIRED',
      error: `remote ${input.kind} peer requires AspBridge external mode (V2 TCP pending): ${input.jid}`,
    }
  }
  return {
    ok: false,
    code: 'ASP_BRIDGE_DISCONNECTED',
    error: 'remote peer requires AspBridge external (not connected)',
  }
}

/** Detect legacy remote.* node hints on desktop.local JIDs. */
export function isRemoteNodeHintJid(jid: string): boolean {
  try {
    const parsed = parseJid(jid)
    if (parsed.domain !== 'desktop.local') return false
    const node = parsed.node.toLowerCase()
    return node.startsWith('remote.') || node.includes('remote')
  } catch {
    return false
  }
}
