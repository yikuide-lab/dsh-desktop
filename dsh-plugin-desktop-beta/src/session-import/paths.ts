/** Resolve on-disk roots for Claude Code, Codex, and OpenCode. */

import { homedir } from 'node:os'
import { join } from 'node:path'

export interface SessionImportRoots {
  readonly claudeProjects: string
  readonly codexSessions: string
  readonly codexArchived: string
  readonly opencodeData: string
}

/** Resolve import roots from env overrides and the user home directory. */
export function resolveSessionImportRoots(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): SessionImportRoots {
  const claudeConfig = env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude')
  const codexHome = env.CODEX_HOME?.trim() || join(home, '.codex')
  const opencodeData = firstPath(env.OPENCODE_DATA_DIR) || join(home, '.local', 'share', 'opencode')
  return {
    claudeProjects: join(claudeConfig, 'projects'),
    codexSessions: join(codexHome, 'sessions'),
    codexArchived: join(codexHome, 'archived_sessions'),
    opencodeData,
  }
}

function firstPath(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const first = raw.split(',')[0]?.trim()
  return first || undefined
}

/**
 * Best-effort reverse of Claude's cwd→slug encoding
 * (`/` and non-alphanumeric → `-`, leading `/` becomes a leading `-`).
 * Not lossless; used only for display when the transcript lacks `cwd`.
 */
export function claudeSlugToDisplayCwd(slug: string): string {
  if (!slug) return ''
  if (slug.startsWith('-')) return `/${slug.slice(1).replace(/-/g, '/')}`
  return slug.replace(/-/g, '/')
}
