/** Remote session/agent peer gate — V2 AspBridge path (no fake remote execution). */
import type { AspBridgeMode } from './bus.js';
import type { PeerKind } from './types.js';
export type RemotePeerErrorCode = 'REMOTE_PEER_DISABLED' | 'REMOTE_PEER_ASP_REQUIRED' | 'ASP_BRIDGE_DISCONNECTED';
export interface RemotePeerDecision {
    ok: boolean;
    code?: RemotePeerErrorCode;
    error?: string;
}
export declare function isRemoteDomainJid(jid: string): boolean;
/** Resolve whether a session/agent peer with a non-local JID may proceed. */
export declare function resolveRemoteSessionAgentPeer(input: {
    jid: string;
    kind: PeerKind;
    allowRemotePeers: boolean;
    aspBridgeMode: AspBridgeMode;
}): RemotePeerDecision;
/** Detect legacy remote.* node hints on desktop.local JIDs. */
export declare function isRemoteNodeHintJid(jid: string): boolean;
//# sourceMappingURL=remote-peer.d.ts.map