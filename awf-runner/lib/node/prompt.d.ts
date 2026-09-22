/**
 * Prompt construction for headless workflow steps.
 *
 * Mirrors the desktop Host executor (desktop-workflow-executor.ts) so llm/task
 * steps see the same substitution, upstream-output, and acceptance/outputs
 * sections whether they run in the Electron Host or on an awf-node runner.
 */
import type { ExecutionContext, Step } from 'dsh-plugin-workflow/engine';
export declare function substituteParams(text: string, context: ExecutionContext): string;
export declare function formatStepOutput(output: unknown): string;
export declare function appendContextSections(prompt: string, context: ExecutionContext): string;
export declare function buildLlmPrompt(step: Step, context: ExecutionContext): string;
export declare function buildLlmSystemPrompt(step: Step): string;
export declare function buildTaskPrompt(step: Step, context: ExecutionContext, cwd: string): string;
/** Default / clamp LLM completion budget for workflow steps (desktop parity). */
export declare function resolveLlmMaxTokens(step: Step): number;
//# sourceMappingURL=prompt.d.ts.map