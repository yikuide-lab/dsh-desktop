/**
 * Per-workflow usage aggregates derived from retained run history.
 */
import { type Run, type Workflow } from './models.js';
export interface WorkflowStatsSummary {
    readonly workflowName: string;
    readonly title?: string;
    readonly totalRuns: number;
    readonly completed: number;
    readonly failed: number;
    readonly aborted: number;
    readonly running: number;
    /** completed / (completed + failed + aborted); 0 when no terminal runs. */
    readonly successRate: number;
    readonly avgDurationMs: number | null;
    readonly lastRunAt: string | null;
    readonly lastStatus: string | null;
}
export interface WorkflowStatsDayBucket {
    readonly date: string;
    readonly total: number;
    readonly completed: number;
    readonly failed: number;
    readonly avgDurationMs: number | null;
}
export interface WorkflowStatsRecentRun {
    readonly id: string;
    readonly status: string;
    readonly startedAt: string;
    readonly completedAt?: string;
    readonly durationMs?: number;
    readonly error?: string;
}
export interface WorkflowStatsDetail extends WorkflowStatsSummary {
    readonly byDay: readonly WorkflowStatsDayBucket[];
    readonly recentRuns: readonly WorkflowStatsRecentRun[];
}
/** Top-level runs only (exclude nested sub_workflow children). */
export declare function isTopLevelRun(run: Run): boolean;
/** Aggregate retained top-level runs for one workflow. */
export declare function summarizeWorkflowRuns(workflowName: string, runs: readonly Run[], title?: string): WorkflowStatsSummary;
export declare function buildDayBuckets(runs: readonly Run[], sinceMs: number): WorkflowStatsDayBucket[];
export declare function buildRecentRuns(runs: readonly Run[], limit: number): WorkflowStatsRecentRun[];
export declare function buildWorkflowStatsSummaries(workflows: readonly Workflow[], allRuns: readonly Run[]): WorkflowStatsSummary[];
export declare function buildWorkflowStatsDetail(workflowName: string, workflows: readonly Workflow[], allRuns: readonly Run[], options?: {
    since?: string;
    recentLimit?: number;
}): WorkflowStatsDetail;
//# sourceMappingURL=workflow-stats.d.ts.map