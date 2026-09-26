/**
 * Minimal ASP v1 AgentStreamMessage protobuf codec (no codegen dependency).
 * Wire: sibling ai-agent-protocol/proto/agent_protocol.proto
 * Framing (elsewhere): u32 BE length + SerializeToString bytes.
 */
import type { CollabEnvelope } from './types.js';
/** Encode CollabEnvelope as ASP AgentStreamMessage bytes. */
export declare function encodeAgentStreamMessage(envelope: CollabEnvelope): Buffer;
/** Encode PLAIN auth handshake AgentStreamMessage. */
export declare function encodeAuthRequestMessage(input: {
    id: string;
    from_jid: string;
    password: string;
    timestampMs?: number;
}): Buffer;
export interface DecodedAuthResponse {
    success: boolean;
    error_message?: string;
    bound_resource?: string;
}
export declare function decodeAuthResponseMessage(buf: Buffer): DecodedAuthResponse | undefined;
/** Decode ASP AgentStreamMessage bytes into a CollabEnvelope (non-auth payloads). */
export declare function decodeAgentStreamMessage(buf: Buffer): CollabEnvelope | undefined;
/** Length-prefix a protobuf payload (ASP stream frame). */
export declare function frameAspPayload(payload: Buffer): Buffer;
/** Encode auth response helper for test servers. */
export declare function encodeAuthResponseMessage(input: {
    id: string;
    from_jid?: string;
    to_jid: string;
    success: boolean;
    bound_resource?: string;
    error_message?: string;
    timestampMs?: number;
}): Buffer;
//# sourceMappingURL=asp-proto.d.ts.map