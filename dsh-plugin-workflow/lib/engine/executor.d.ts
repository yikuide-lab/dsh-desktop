/**
 * Default and script-capable workflow executors.
 */
import type { ExecutionContext, Executor, Step } from './models.js';
import { type ScriptPolicy } from './script-policy.js';
import type { RsiReviewer } from './rsi-review.js';
export interface StepOutcome {
    ok: boolean;
    output?: unknown;
    error?: string;
}
/** Optional Host-bound runners for LLM, task, nested workflow steps, and RSI review. */
export interface DesktopExecutorHooks {
    runLlm?: (step: Step, context: ExecutionContext, cwd: string, signal: AbortSignal) => Promise<StepOutcome>;
    runTask?: (step: Step, context: ExecutionContext, cwd: string, signal: AbortSignal) => Promise<StepOutcome>;
    runSubWorkflow?: (step: Step, context: ExecutionContext, signal: AbortSignal) => Promise<StepOutcome>;
    /** RSI review pass over a workflow YAML (absent → engine's deterministic stub). */
    runRsiReview?: RsiReviewer;
}
/** Create an executor that runs script steps in a shell and optional Host hooks. */
export declare function createDesktopExecutor(options?: {
    shell?: string;
    cwd?: string;
    hooks?: DesktopExecutorHooks;
    scriptPolicy?: ScriptPolicy;
}): Executor;
//# sourceMappingURL=executor.d.ts.map