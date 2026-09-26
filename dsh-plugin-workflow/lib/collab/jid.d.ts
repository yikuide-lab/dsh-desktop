/** ASP-shaped JID parse/format for desktop.local peers */
import type { PeerKind } from './types.js';
export declare const DESKTOP_LOCAL_DOMAIN = "desktop.local";
export interface ParsedJid {
    node: string;
    domain: string;
    resource?: string;
    bare: string;
    full: string;
}
export declare function parseJid(jid: string): ParsedJid;
export declare function formatJid(node: string, domain?: string, resource?: string): string;
export declare function isLocalDesktopJid(jid: string): boolean;
export declare function peerKindFromJid(jid: string): PeerKind | 'admin' | 'awf';
export declare function rosterPeerKindFromJid(jid: string): PeerKind;
//# sourceMappingURL=jid.d.ts.map