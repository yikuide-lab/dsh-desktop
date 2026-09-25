/** Convert a selected external session into turns for DSH seed creation. */

import { convertClaudeSession } from './convert-claude.js'
import { convertCodexSession } from './convert-codex.js'
import { convertOpencodeSession } from './convert-opencode.js'
import type { ConvertResult, ExternalSessionSource } from './types.js'

/** Load and convert one external session by source + path (+ optional id). */
export function convertExternalSession(input: {
  source: ExternalSessionSource
  sourcePath: string
  id?: string
}): ConvertResult {
  switch (input.source) {
    case 'claude':
      return convertClaudeSession(input.sourcePath)
    case 'codex':
      return convertCodexSession(input.sourcePath)
    case 'opencode':
      return convertOpencodeSession(input.sourcePath, input.id)
    default: {
      const _exhaustive: never = input.source
      return _exhaustive
    }
  }
}
