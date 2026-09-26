/** Collab Loop filesystem path resolution */

import { homedir } from 'node:os'
import { join } from 'node:path'

export const COLLAB_DIR_NAME = 'collab'
export const SECRET_FILE_NAME = 'secret'

export function resolveDshHome(): string {
  const fromEnv = process.env.DSH_HOME?.trim()
  if (fromEnv) return fromEnv
  return join(homedir(), '.dsh')
}

export function resolveCollabRoot(): string {
  return join(resolveDshHome(), COLLAB_DIR_NAME)
}

export function resolveGlobalSecretPath(): string {
  return join(resolveCollabRoot(), SECRET_FILE_NAME)
}

export function resolveLoopDir(loopId: string): string {
  return join(resolveCollabRoot(), loopId)
}

export function resolveLoopFile(loopId: string, ...segments: string[]): string {
  return join(resolveLoopDir(loopId), ...segments)
}
