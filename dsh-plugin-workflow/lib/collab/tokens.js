/** HMAC-SHA256 CapabilityToken issue/verify/revoke by epoch */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
const TOKEN_VERSION = 1;
function canonicalPayload(input) {
    return JSON.stringify({
        v: TOKEN_VERSION,
        loopId: input.loopId,
        subject_jid: input.subject_jid,
        issuer_did: input.issuer_did ?? null,
        subject_did: input.subject_did ?? null,
        permissions: [...input.permissions].sort(),
        issued_at: input.issued_at,
        expires_at: input.expires_at,
        epoch: input.epoch,
    });
}
function signPayload(payload, secret) {
    return createHmac('sha256', secret).update(payload).digest('base64url');
}
export function issueCapToken(input) {
    const nowMs = input.nowMs ?? Date.now();
    const issued_at = new Date(nowMs).toISOString();
    const expires_at = new Date(nowMs + (input.ttlMs ?? 3_600_000)).toISOString();
    const body = {
        loopId: input.loopId,
        subject_jid: input.subject_jid,
        permissions: input.permissions,
        issued_at,
        expires_at,
        epoch: input.epoch,
        ...(input.issuer_did !== undefined ? { issuer_did: input.issuer_did } : {}),
        ...(input.subject_did !== undefined ? { subject_did: input.subject_did } : {}),
    };
    const signature = signPayload(canonicalPayload(body), input.secret);
    return { ...body, signature };
}
export function verifyCapToken(options) {
    const { token, secret, loopId, subject_jid, expectedEpoch } = options;
    if (token.loopId !== loopId)
        return false;
    if (token.subject_jid !== subject_jid)
        return false;
    if (token.epoch !== expectedEpoch)
        return false;
    if (options.subject_did !== undefined) {
        if (token.subject_did !== options.subject_did)
            return false;
    }
    const nowMs = options.nowMs ?? Date.now();
    if (Date.parse(token.expires_at) <= nowMs)
        return false;
    const expectedSig = signPayload(canonicalPayload({
        loopId: token.loopId,
        subject_jid: token.subject_jid,
        permissions: token.permissions,
        issued_at: token.issued_at,
        expires_at: token.expires_at,
        epoch: token.epoch,
        ...(token.issuer_did !== undefined ? { issuer_did: token.issuer_did } : {}),
        ...(token.subject_did !== undefined ? { subject_did: token.subject_did } : {}),
    }), secret);
    const a = Buffer.from(token.signature);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !timingSafeEqual(a, b))
        return false;
    if (options.requiredPermissions?.length) {
        const granted = new Set(token.permissions);
        for (const perm of options.requiredPermissions) {
            if (!granted.has(perm))
                return false;
        }
    }
    return true;
}
/** Epoch bump invalidates all tokens for the prior epoch — no persistent revoke list needed. */
export function isTokenEpochRevoked(tokenEpoch, currentEpoch) {
    return tokenEpoch !== currentEpoch;
}
export function generateCollabSecret(byteLength = 32) {
    return randomBytes(byteLength);
}
//# sourceMappingURL=tokens.js.map