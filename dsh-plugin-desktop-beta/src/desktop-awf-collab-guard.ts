/**
 * AWF sync guard: collab orchestration must stay on Desktop Host only.
 *
 * Workflows containing `collab_peer` steps or `requires: [collab]` must not be
 * pushed to the AWF platform (collab state never lands in AWF DB).
 */

import { StepType } from 'dsh-plugin-workflow/engine'

export const AWF_SYNC_COLLAB_REJECT_MESSAGE =
  'AWF 同步不允许包含 collab_peer 步骤或 requires: collab 能力（协作编排仅限本地 Desktop Host）'

export interface AwfSyncGuardInput {
  /** Raw YAML text (regex pre-scan when structured steps are absent). */
  yaml?: string
  /** Parsed workflow steps (preferred when available). */
  steps?: readonly { readonly type: string }[]
  /** Workflow metadata.requires capability list. */
  requires?: readonly string[]
}

export type AwfSyncGuardResult =
  | { ok: true }
  | { ok: false; error: string }

function requiresCollab(requires: readonly string[] | undefined): boolean {
  return (requires ?? []).some((entry) => entry.trim().toLowerCase() === 'collab')
}

function stepsContainCollabPeer(steps: readonly { type: string }[] | undefined): boolean {
  return (steps ?? []).some((step) => step.type === 'collab_peer' || step.type === StepType.CollabPeer)
}

/** Heuristic YAML scan when only text is available (no parsed model). */
function yamlHintsCollab(yaml: string): boolean {
  if (/type:\s*['"]?collab_peer['"]?/m.test(yaml)) return true
  if (/requires:\s*\n(?:[ \t]*-\s*[^\n]+\n)+/m.test(yaml)) {
    if (/(?:^|\n)[ \t]*-\s*collab\s*(?:#|$|\n)/m.test(yaml)) return true
  }
  if (/requires:\s*\[\s*[^\]]*\bcollab\b/m.test(yaml)) return true
  return false
}

/** Pure guard: reject AWF sync when collab_peer steps or collab capability are present. */
export function assertAwfSyncAllowed(input: AwfSyncGuardInput): AwfSyncGuardResult {
  if (requiresCollab(input.requires)) {
    return { ok: false, error: AWF_SYNC_COLLAB_REJECT_MESSAGE }
  }
  if (stepsContainCollabPeer(input.steps)) {
    return { ok: false, error: AWF_SYNC_COLLAB_REJECT_MESSAGE }
  }
  if (input.yaml && yamlHintsCollab(input.yaml)) {
    return { ok: false, error: AWF_SYNC_COLLAB_REJECT_MESSAGE }
  }
  return { ok: true }
}
