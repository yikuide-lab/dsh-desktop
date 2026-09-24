/**
 * RSI review contract: one review + improvement pass over a workflow YAML.
 * Shared by the pure-Node engine (storing verdicts), the Desktop Host executor
 * (streaming LLM), and the headless awf-node runner (chat completions).
 */
/** Input for one RSI review/improve pass over a workflow YAML baseline. */
export interface RsiReviewRequest {
    /** Problem being iterated (for reviewer-side logging). */
    problemId: number;
    /** Problem title. */
    title: string;
    /** Problem domain tag, e.g. summarization. */
    domain: string;
    /** What "better" means for this problem. */
    improvementCriteria: string;
    /** 0-based iteration number within the problem. */
    iterationNumber: number;
    /** Workflow YAML under review (baseline, or the previous iteration's improvement). */
    yaml: string;
    /** Review feedback from the previous iteration, when any. */
    priorFeedback?: string;
}
/** Outcome of one RSI review/improve pass. */
export interface RsiReviewResult {
    /** Review score clamped to 0-100. */
    score: number;
    /** Review comments, carried into the next iteration as prior feedback. */
    feedback: string;
    /** Improved workflow YAML (equals the input when the reviewer found no change). */
    improvedYaml: string;
}
/**
 * Host-bound RSI reviewer. Without one the engine falls back to its
 * deterministic stub so the loop stays runnable on pure Node.
 */
export type RsiReviewer = (request: RsiReviewRequest, signal?: AbortSignal) => Promise<RsiReviewResult>;
/** Completion budget for one review + improvement response (the improved YAML rides along). */
export declare const RSI_REVIEW_MAX_TOKENS = 8192;
/** Build the system + user prompt for one RSI review pass. */
export declare function buildRsiReviewPrompt(request: RsiReviewRequest): {
    system: string;
    user: string;
};
/**
 * Parse a reviewer response into an RsiReviewResult.
 * @param text - Raw model output (bare JSON, fenced JSON, or JSON inside prose).
 * @param fallbackYaml - YAML to keep when the reviewer returns no improvement.
 * @returns The clamped, normalized verdict.
 */
export declare function parseRsiReviewResponse(text: string, fallbackYaml: string): RsiReviewResult;
//# sourceMappingURL=rsi-review.d.ts.map