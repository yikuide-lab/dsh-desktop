/**
 * Optional W3C DID helpers for Collab identity federation (V2 stub).
 * Aligns with ASP SecureEnvelope.sender_did / CapabilityToken.issuer_did.
 * No ledger or DID resolution — syntax + optional JID binding only.
 */
/** Minimal W3C DID method-specific-id grammar (did:method:id). */
const DID_RE = /^did:[a-z0-9]+:[A-Za-z0-9._\-:%]+$/;
export function isValidDid(value) {
    const trimmed = value.trim();
    if (trimmed.length < 8 || trimmed.length > 512)
        return false;
    return DID_RE.test(trimmed);
}
export function normalizeDid(value) {
    const trimmed = value.trim();
    if (!isValidDid(trimmed)) {
        throw new Error(`Invalid DID: ${value}`);
    }
    return trimmed;
}
/**
 * When both DID and JID are present, they must agree if the DID embeds the
 * JID after `did:dsh:` (Desktop local convention). Other methods are accepted
 * as opaque federated identities.
 */
export function didBindsJid(did, jid) {
    const normalized = normalizeDid(did);
    if (!normalized.startsWith('did:dsh:'))
        return true;
    const embedded = decodeURIComponent(normalized.slice('did:dsh:'.length));
    return embedded === jid || embedded === jid.split('/')[0];
}
/** Build a Desktop-local DID that embeds a bare or full JID. */
export function didFromLocalJid(jid) {
    return `did:dsh:${encodeURIComponent(jid.trim())}`;
}
//# sourceMappingURL=did.js.map