/** TaskPlanner pure parse/validate/apply with assign > invite > branch > open priority */
import type { BranchRecord, CollabVision, LoopRoster, TaskPlan, TaskPlanApplyResult } from './types.js';
export declare function parseTaskPlan(raw: unknown): TaskPlan;
export declare function validateTaskPlan(plan: TaskPlan): void;
export declare function applyTaskPlanPriority(input: {
    plan: TaskPlan;
    roster: LoopRoster;
    vision?: CollabVision;
    branches?: BranchRecord[];
    nowMs?: number;
}): TaskPlanApplyResult;
//# sourceMappingURL=plan.d.ts.map