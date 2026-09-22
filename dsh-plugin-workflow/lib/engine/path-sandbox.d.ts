/**
 * Path helpers for workspace-rooted script execution.
 */
/** True when `candidate` is `root` or a path inside `root`. */
export declare function isPathInsideRoot(root: string, candidate: string): boolean;
/**
 * Resolve script cwd under an optional workspace jail.
 * When `workspaceRoot` is set, cwd outside the root is rejected.
 */
export declare function resolveSandboxedCwd(requestedCwd: string, workspaceRoot: string | undefined): string;
//# sourceMappingURL=path-sandbox.d.ts.map