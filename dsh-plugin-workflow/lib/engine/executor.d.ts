/**
 * Default and script-capable workflow executors.
 */
import type { ExecutionContext, Executor, Step } from './models.js';
import { type ScriptPolicy } from './script-policy.js';
export interface StepOutcome {
    ok: boolean;
    output?: unknown;
    error?: string;
}
/** Optional Host-bound runners for LLM, task, and nested workflow steps. */
export interface DesktopExecutorHooks {
    runLlm?: (step: Step, context: ExecutionContext, cwd: string, signal: AbortSignal) => Promise<StepOutcome>;
    runTask?: (step: Step, context: ExecutionContext, cwd: string, signal: AbortSignal) => Promise<StepOutcome>;
    runSubWorkflow?: (step: Step, context: ExecutionContext, signal: AbortSignal) => Promise<StepOutcome>;
}
/** Create an executor that runs script steps in a shell and optional Host hooks. */
export declare function createDesktopExecutor(options?: {
    shell?: string;
    cwd?: string;
    hooks?: DesktopExecutorHooks;
    scriptPolicy?: ScriptPolicy;
}): Executor;
//# sourceMappingURL=executor.d.ts.map