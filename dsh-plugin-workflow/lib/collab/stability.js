/** StabilityController pure tick — heartbeat soft miss and offline grace */
export const DEFAULT_STABILITY = {
    heartbeatMs: 15_000,
    offlineGraceMs: 45_000,
};
function isoNow(nowMs) {
    return new Date(nowMs).toISOString();
}
function orphanGoalsForJid(vision, jid, nowMs) {
    const events = [];
    const goals = vision.goals.map((goal) => {
        if (goal.ownerJid === jid && goal.status !== 'done' && goal.status !== 'orphaned') {
            events.push({
                type: 'goal.orphaned',
                at: isoNow(nowMs),
                jid,
                goalId: goal.id,
            });
            return { ...goal, status: 'orphaned', ownerJid: undefined };
        }
        return goal;
    });
    return {
        vision: { ...vision, goals, updatedAt: isoNow(nowMs) },
        events,
    };
}
function elapsedSince(lastSeenAt, nowMs) {
    if (!lastSeenAt)
        return Number.POSITIVE_INFINITY;
    return nowMs - Date.parse(lastSeenAt);
}
function applyMemberStability(member, nowMs, defaults) {
    if (member.lifecycle !== 'active' || member.paused) {
        return { member, wentOffline: false };
    }
    const elapsed = elapsedSince(member.lastSeenAt, nowMs);
    if (elapsed > defaults.offlineGraceMs) {
        if (member.show === 'OFFLINE') {
            return { member, wentOffline: false };
        }
        return {
            member: { ...member, show: 'OFFLINE' },
            wentOffline: true,
        };
    }
    if (elapsed > defaults.heartbeatMs) {
        if (member.show === 'AWAY' || member.show === 'OFFLINE') {
            return { member, wentOffline: false };
        }
        return { member: { ...member, show: 'AWAY' }, wentOffline: false };
    }
    if (member.show === 'AWAY') {
        return { member: { ...member, show: 'ONLINE' }, wentOffline: false };
    }
    return { member, wentOffline: false };
}
export function tick(roster, vision, nowMs, defaults = DEFAULT_STABILITY) {
    const events = [];
    const members = [];
    let nextVision = vision;
    for (const member of roster.members) {
        const { member: updated, wentOffline } = applyMemberStability(member, nowMs, defaults);
        members.push(updated);
        if (wentOffline && updated.jid) {
            events.push({
                type: 'member.offline',
                at: isoNow(nowMs),
                jid: updated.jid,
                slot: updated.slot,
            });
            if (nextVision) {
                const orphaned = orphanGoalsForJid(nextVision, updated.jid, nowMs);
                nextVision = orphaned.vision;
                events.push(...orphaned.events);
            }
        }
    }
    return {
        roster: { ...roster, members, updatedAt: isoNow(nowMs) },
        vision: nextVision,
        events,
    };
}
//# sourceMappingURL=stability.js.map