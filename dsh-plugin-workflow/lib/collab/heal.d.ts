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
/** Low-risk actions eligible for auto-heal when canHealAuto is enabled. */
export declare function isLowRiskHealAction(action: HealAction): boolean;
//# sourceMappingURL=heal.d.ts.map