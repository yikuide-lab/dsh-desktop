/** HMAC-SHA256 CapabilityToken issue/verify/revoke by epoch */
import type { CapToken } from './types.js';
export declare function issueCapToken(input: {
    loopId: string;
    subject_jid: string;
    permissions: string[];
    epoch: number;
    secret: Buffer;
    ttlMs?: number;
    nowMs?: number;
    issuer_did?: string;
    subject_did?: string;
}): CapToken;
export interface VerifyCapTokenOptions {
    token: CapToken;
    secret: Buffer;
    loopId: string;
    subject_jid: string;
    requiredPermissions?: string[];
    expectedEpoch: number;
    nowMs?: number;
    /** When set, token.subject_did must match (federation check). */
    subject_did?: string;
}
export declare function verifyCapToken(options: VerifyCapTokenOptions): boolean;
/** Epoch bump invalidates all tokens for the prior epoch — no persistent revoke list needed. */
export declare function isTokenEpochRevoked(tokenEpoch: number, currentEpoch: number): boolean;
export declare function generateCollabSecret(byteLength?: number): Buffer;
//# sourceMappingURL=tokens.d.ts.map