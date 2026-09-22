/**
 * Path helpers for workspace-rooted script execution.
 */

import { isAbsolute, relative, resolve, sep } from 'node:path'

/** True when `candidate` is `root` or a path inside `root`. */
export function isPathInsideRoot(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root)
  const resolvedCandidate = resolve(candidate)
  if (resolvedCandidate === resolvedRoot) return true
  const rel = relative(resolvedRoot, resolvedCandidate)
  return rel !== '' && !rel.startsWith(`..${sep}`) && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Resolve script cwd under an optional workspace jail.
 * When `workspaceRoot` is set, cwd outside the root is rejected.
 */
export function resolveSandboxedCwd(
  requestedCwd: string,
  workspaceRoot: string | undefined,
): string {
  const cwd = resolve(requestedCwd)
  if (!workspaceRoot || !workspaceRoot.trim()) return cwd
  const root = resolve(workspaceRoot.trim())
  if (!isPathInsideRoot(root, cwd)) {
    throw new Error(`Script cwd escapes workspaceRoot (${root}): ${cwd}`)
  }
  return cwd
}
