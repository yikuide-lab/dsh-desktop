/**
 * Script execution policy for Desktop / Host executors.
 */
export type ScriptPolicy = 'allow' | 'deny' | 'workspace-only';
/**
 * Resolve script cwd under the active policy.
 * - allow: jail when WORKSPACE_ROOT is set; otherwise unrestricted
 * - workspace-only: require WORKSPACE_ROOT and jail under it
 * - deny: reject all script steps
 */
export declare function resolveScriptCwd(policy: ScriptPolicy, requestedCwd: string, workspaceRoot: string | undefined): string;
//# sourceMappingURL=script-policy.d.ts.map