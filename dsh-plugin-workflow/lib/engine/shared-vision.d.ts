/**
 * Run-level shared vision helpers for workflow steps.
 * Steps may publish `{ shared: {...} }` or `{ vision_append: "..." }` in results.
 */
/** Extract a mergeable shared patch from a step result. */
export declare function extractSharedPatch(output: unknown): Record<string, unknown> | null;
/** Shallow-merge shared patches; concatenate vision_append strings. */
export declare function mergeSharedVision(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown>;
//# sourceMappingURL=shared-vision.d.ts.map