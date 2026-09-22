/**
 * Workflow Coordinator
 * TypeScript rewrite of workflow-wise coordinator/loop.ts
 * Event-driven tick loop for dispatching tasks within concurrency budgets
 */
import { EventEmitter } from 'node:events';
import type { Workflow, Run, StepResult, Executor, Step } from './models.js';
import { type FailurePolicyDefaults } from './engine.js';
export interface TickStats {
    ticks: number;
    dispatches: number;
    settlements: number;
    errors: number;
}
export interface CoordinatorOptions {
    maxConcurrency: number;
    tickInterval: number;
    heartbeatTimeout: number;
    failurePolicy: FailurePolicyDefaults;
}
export interface CoordinatorState {
    run: Run;
    workflow: Workflow;
    executor: Executor;
}
export interface CoordinatorEvents {
    'tick:start': (stats: TickStats) => void;
    'tick:end': (stats: TickStats) => void;
    'task:dispatch': (stepId: string, dispatchId: string) => void;
    'task:settle': (stepId: string, dispatchId: string, result: StepResult) => void;
    'run:complete': (run: Run) => void;
    'run:fail': (run: Run, error: Error) => void;
    'error': (error: Error) => void;
}
export declare class Coordinator extends EventEmitter {
    private state;
    private options;
    private stats;
    private tickTimer;
    private running;
    /** Run-level shared vision blackboard. */
    private shared;
    constructor(options?: Partial<CoordinatorOptions>);
    /** Update global failure defaults (retries / on_failure) for subsequent settles. */
    setFailurePolicy(policy: Partial<FailurePolicyDefaults>): void;
    /**
     * Initialize the coordinator with a run
     */
    init(workflow: Workflow, executor: Executor, params?: Record<string, unknown>, lineage?: {
        parentRunId?: string;
        rootRunId?: string;
        coordinatorId?: string;
    }): Promise<Run>;
    /**
     * Resume from an existing run state
     */
    resume(workflow: Workflow, run: Run, executor: Executor): Promise<void>;
    /** Prevent overlapping async ticks from double-dispatching. */
    private ticking;
    private tickPending;
    /**
     * Start the tick loop
     */
    start(): void;
    /**
     * Stop the tick loop
     */
    stop(): void;
    /** Serialize ticks so interval callbacks cannot overlap. */
    private safeTick;
    /**
     * Abort in-flight dispatches, stop the tick loop, and mark the live run aborted.
     */
    abortRun(reason?: string): Promise<Run | null>;
    /**
     * Single tick - main coordination logic
     */
    tick(): Promise<TickStats>;
    /**
     * Run until no more tasks can be dispatched
     */
    runUntilIdle(): Promise<Run>;
    /**
     * Get current run state
     */
    getRun(): Run | null;
    /**
     * Get statistics
     */
    getStats(): TickStats;
    /**
     * Resolve an approval gate
     */
    resolveGate(stepId: string, decision: string, resolvedBy: string, token: string): void;
}
/** Per-dispatch wall-clock limit: step.timeout, else script default 600s, else heartbeat ceiling. */
export declare function resolveDispatchTimeLimitMs(step: Step | undefined, heartbeatTimeoutMs: number): number;
//# sourceMappingURL=coordinator.d.ts.map