/** Public pure-Node surface for harness session import. */

export type {
  ConvertResult,
  ExternalSessionSource,
  ExternalSessionSummary,
  ImportedTurn,
  SessionImportImportRequest,
  SessionImportImportResult,
  SessionImportListRequest,
  SessionImportSearchRequest,
} from './types.js'
export { resolveSessionImportRoots, claudeSlugToDisplayCwd } from './paths.js'
export type { SessionImportRoots } from './paths.js'
export { listExternalSessions, searchExternalSessions } from './search.js'
export { convertExternalSession } from './import-one.js'
export { buildSeedEvents } from './build-seed.js'
export { convertClaudeSession } from './convert-claude.js'
export { convertCodexSession } from './convert-codex.js'
export { convertOpencodeSession } from './convert-opencode.js'
