/** Contract for the private Desktop session-import HTTP bridge. */

export const DESKTOP_SESSION_IMPORT_PATH = '/api/desktop/session-import'

export type DesktopSessionImportOp = 'list' | 'search' | 'import'

export interface DesktopSessionImportRequest {
  readonly op: DesktopSessionImportOp
  readonly sources?: readonly ('claude' | 'codex' | 'opencode')[]
  readonly query?: string
  readonly content?: boolean
  readonly source?: 'claude' | 'codex' | 'opencode'
  readonly id?: string
  readonly sourcePath?: string
  readonly fallbackCwd?: string
}

export interface DesktopSessionImportErrorResponse {
  readonly ok: false
  readonly error: string
}
