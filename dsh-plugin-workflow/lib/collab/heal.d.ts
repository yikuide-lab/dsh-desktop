/** NetworkHealer pure parse/validate/apply — proposes mutations only */
import type { CollabVision, HealAction, HealApplyResult, HealPlan, LoopRoster } from './types.js';
export declare function parseHealPlan(raw: unknown): HealPlan;
export declare function validateHealPlan(plan: HealPlan): void;
/** Always returns proposed mutations; does not gate on canHealAuto. */
export declare function applyHealActions(input: {
    plan: HealPlan;
    roster: LoopRoster;
    vision?: CollabVision;
    nowMs?: number;
}): HealApplyResult;
export declare const DEFAULT_HEAL_AUTO_ALLOW: readonly ["nudge_rejoin", "reassign_goal", "invite"];
export declare const DEFAULT_HEAL_AUTO_DENY: readonly ["isolate", "spawn_repair_branch", "escalate_admin"];
/** Low-risk actions eligible for auto-heal when canHealAuto is enabled (legacy helper). */
export declare function isLowRiskHealAction(action: HealAction): boolean;
/** Filter heal plan actions by admin healAutoAllow when canHealAuto is enabled. */
export declare function filterHealActionsForAuto(actions: HealAction[], control: {
    canHealAuto: boolean;
    healAutoAllow?: readonly string[];
}): HealAction[];
//# sourceMappingURL=heal.d.ts.map