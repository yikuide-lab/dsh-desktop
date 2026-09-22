/**
 * Workflow Execution Engine
 * TypeScript rewrite of workflow-wise engine/engine.ts
 */
import { type Workflow, type Run, type Gate, type Step, type StepResult, type OnFailurePolicy, type Compensation, WorkflowStatus } from './models.js';
/**
 * Effective dispatch concurrency for a workflow run.
 * Takes the minimum of coordinator default, spec.max_concurrency, and
 * resources named/typed `concurrency` with a numeric limit.
 */
export declare function resolveEffectiveConcurrency(workflow: Workflow, fallback: number): number;
/** Defaults applied when a step omits retries / on_failure. */
export interface FailurePolicyDefaults {
    defaultRetries: number;
    defaultOnFailure: OnFailurePolicy;
}
export declare const DEFAULT_FAILURE_POLICY: FailurePolicyDefaults;
export declare function resolveRetryLimit(step: Step | undefined, defaults?: FailurePolicyDefaults): number;
export declare function resolveOnFailure(step: Step | undefined, defaults?: FailurePolicyDefaults): OnFailurePolicy;
export declare function canTransition(from: WorkflowStatus, to: WorkflowStatus): boolean;
export declare function transitionWorkflow(run: Run, to: WorkflowStatus, error?: string): Run;
export declare function createRun(workflow: Workflow, params?: Record<string, unknown>, coordinatorId?: string, lineage?: {
    parentRunId?: string;
    rootRunId?: string;
}): Run;
/**
 * Compute the set of tasks that are ready to execute.
 * A task is ready when:
 * 1. Its status is Pending
 * 2. All dependencies are Completed or Skipped (skip/compensate failback)
 */
export declare function computeReady(run: Run, workflow: Workflow): string[];
/** Mark pending tasks unreachable because a hard-failed dependency will never complete. */
export declare function skipUnreachableTasks(run: Run, workflow: Workflow): Run;
export declare function dispatchTask(run: Run, stepId: string, concurrencyBudget: number): {
    run: Run;
    dispatchId: string;
};
export interface SettleDispatchOptions {
    workflow: Workflow;
    defaults?: FailurePolicyDefaults;
}
export interface SettleDispatchResult {
    run: Run;
    /** When set, coordinator should submit the compensation script for this step. */
    pendingCompensation?: {
        stepId: string;
        compensation: Compensation;
        originalError?: string;
    };
}
export declare function settleDispatch(run: Run, dispatchId: string, result: StepResult, options?: SettleDispatchOptions): SettleDispatchResult;
/** Allocate a compensation dispatch on an in-progress failed task. */
export declare function dispatchCompensation(run: Run, stepId: string): {
    run: Run;
    dispatchId: string;
};
export declare function createGate(run: Run, workflow: Workflow, stepId: string): {
    run: Run;
    gate: Gate;
};
/** Build an approval gate document from a workflow step definition. */
export declare function buildApprovalGate(step: Step): Gate;
/**
 * Decisions that complete an approval gate.
 * Prefer explicit `pass`; else `approved` when listed; else the first option.
 */
export declare function resolveGatePassDecisions(options: readonly string[], pass?: readonly string[]): string[];
/** Whether a gate decision should mark the approval task completed. */
export declare function isGatePass(gate: Pick<Gate, 'options' | 'pass'>, decision: string): boolean;
export declare function resolveGate(run: Run, stepId: string, decision: string, resolvedBy: string, token: string): Run;
export declare function markAborted(run: Run, reason?: string): Run;
export declare function isRunComplete(run: Run): boolean;
export declare function getRunProgress(run: Run): {
    total: number;
    completed: number;
    failed: number;
};
//# sourceMappingURL=engine.d.ts.map