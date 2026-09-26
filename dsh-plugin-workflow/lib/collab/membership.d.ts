/** Pure membership mutations for LoopRoster + CollabVision */
import type { CollabVision, LoopRoster, MembershipResult, PeerKind } from './types.js';
export declare function joinMember(input: {
    roster: LoopRoster;
    vision?: CollabVision;
    jid: string;
    slot: string;
    boundStepId?: string;
    nowMs?: number;
}): MembershipResult;
export declare function leaveMember(input: {
    roster: LoopRoster;
    vision?: CollabVision;
    jid: string;
    nowMs?: number;
}): MembershipResult;
export declare function kickMember(input: {
    roster: LoopRoster;
    vision?: CollabVision;
    jid: string;
    nowMs?: number;
}): MembershipResult;
export declare function heartbeatMember(input: {
    roster: LoopRoster;
    jid: string;
    nowMs?: number;
}): MembershipResult;
export declare function rejoinMember(input: {
    roster: LoopRoster;
    vision?: CollabVision;
    jid: string;
    slot: string;
    mode: 'resume' | 'replace';
    nowMs?: number;
}): MembershipResult;
export declare function inviteMember(input: {
    roster: LoopRoster;
    slot: string;
    role: string;
    kind?: PeerKind;
    nowMs?: number;
}): MembershipResult;
export declare function pauseMember(input: {
    roster: LoopRoster;
    jid: string;
    nowMs?: number;
}): MembershipResult;
export declare function resumeMember(input: {
    roster: LoopRoster;
    jid: string;
    nowMs?: number;
}): MembershipResult;
/** After leave/kick, free the slot for a future join */
export declare function freeVacantSlot(roster: LoopRoster, slot: string, nowMs?: number): LoopRoster;
//# sourceMappingURL=membership.d.ts.map