/**
 * Optional W3C DID helpers for Collab identity federation (V2 stub).
 * Aligns with ASP SecureEnvelope.sender_did / CapabilityToken.issuer_did.
 * No ledger or DID resolution — syntax + optional JID binding only.
 */
export declare function isValidDid(value: string): boolean;
export declare function normalizeDid(value: string): string;
/**
 * When both DID and JID are present, they must agree if the DID embeds the
 * JID after `did:dsh:` (Desktop local convention). Other methods are accepted
 * as opaque federated identities.
 */
export declare function didBindsJid(did: string, jid: string): boolean;
/** Build a Desktop-local DID that embeds a bare or full JID. */
export declare function didFromLocalJid(jid: string): string;
//# sourceMappingURL=did.d.ts.map