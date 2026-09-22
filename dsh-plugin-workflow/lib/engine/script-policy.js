/**
 * Script execution policy for Desktop / Host executors.
 */
import { resolveSandboxedCwd } from './path-sandbox.js';
/**
 * Resolve script cwd under the active policy.
 * - allow: jail when WORKSPACE_ROOT is set; otherwise unrestricted
 * - workspace-only: require WORKSPACE_ROOT and jail under it
 * - deny: reject all script steps
 */
export function resolveScriptCwd(policy, requestedCwd, workspaceRoot) {
    if (policy === 'deny') {
        throw new Error('Script steps are disabled by scriptPolicy=deny');
    }
    if (policy === 'workspace-only') {
        if (!workspaceRoot || !workspaceRoot.trim()) {
            throw new Error('Script steps require WORKSPACE_ROOT when scriptPolicy=workspace-only');
        }
        return resolveSandboxedCwd(requestedCwd, workspaceRoot);
    }
    return resolveSandboxedCwd(requestedCwd, workspaceRoot);
}
//# sourceMappingURL=script-policy.js.map