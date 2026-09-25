/** Shared types for external harness session discovery and import. */

export type ExternalSessionSource = 'claude' | 'codex' | 'opencode'

export interface ExternalSessionSummary {
  /** Stable id within one source (usually the file / session uuid). */
  readonly id: string
  readonly source: ExternalSessionSource
  /** Absolute path of the primary transcript / session record. */
  readonly sourcePath: string
  readonly title: string
  readonly cwd?: string
  readonly mtimeMs: number
  /** Short text snippet for search / list preview. */
  readonly preview: string
}

export interface ImportedTurn {
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly timeMs: number
}

export interface ConvertResult {
  readonly turns: readonly ImportedTurn[]
  readonly cwd?: string
  readonly title: string
  /** Human-readable notes when tool/thinking content was collapsed or skipped. */
  readonly warnings: readonly string[]
}

export interface SessionImportListRequest {
  readonly sources?: readonly ExternalSessionSource[]
}

export interface SessionImportSearchRequest {
  readonly query: string
  readonly sources?: readonly ExternalSessionSource[]
  /** When true, also scan the first chunk of each transcript body. */
  readonly content?: boolean
}

export interface SessionImportImportRequest {
  readonly source: ExternalSessionSource
  readonly id: string
  readonly sourcePath: string
  /** Fallback cwd when the transcript does not record one. */
  readonly fallbackCwd?: string
}

export interface SessionImportImportResult {
  readonly sessionId: string
  readonly title: string
  readonly warnings: readonly string[]
  readonly turnCount: number
}
