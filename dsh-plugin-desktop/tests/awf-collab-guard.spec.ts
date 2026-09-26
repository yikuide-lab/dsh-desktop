import { describe, expect, it } from 'vitest'
import { StepType } from 'dsh-plugin-workflow/engine'
import {
  assertAwfSyncAllowed,
  AWF_SYNC_COLLAB_REJECT_MESSAGE,
} from '../src/desktop-awf-collab-guard.ts'

const CLEAN_YAML = `apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: clean
spec:
  steps:
    - id: say
      type: script
      run: echo hi
`

const COLLAB_PEER_YAML = `apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: collab-local
  requires:
    - collab
spec:
  steps:
    - id: peer
      type: collab_peer
      peer:
        kind: session
        jid: session@desktop.local/ses-1
        open: false
`

describe('assertAwfSyncAllowed', () => {
  it('allows clean workflow YAML without collab', () => {
    expect(assertAwfSyncAllowed({ yaml: CLEAN_YAML })).toEqual({ ok: true })
  })

  it('rejects YAML containing collab_peer steps', () => {
    const result = assertAwfSyncAllowed({ yaml: COLLAB_PEER_YAML })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe(AWF_SYNC_COLLAB_REJECT_MESSAGE)
    }
  })

  it('rejects parsed steps with collab_peer type', () => {
    const result = assertAwfSyncAllowed({
      steps: [{ type: StepType.CollabPeer }],
    })
    expect(result).toEqual({ ok: false, error: AWF_SYNC_COLLAB_REJECT_MESSAGE })
  })

  it('rejects metadata.requires collab capability', () => {
    const result = assertAwfSyncAllowed({ requires: ['gate', 'collab'] })
    expect(result).toEqual({ ok: false, error: AWF_SYNC_COLLAB_REJECT_MESSAGE })
  })

  it('rejects when any collab signal is present (steps override clean yaml scan)', () => {
    const result = assertAwfSyncAllowed({
      yaml: CLEAN_YAML,
      steps: [{ type: StepType.CollabPeer }],
    })
    expect(result.ok).toBe(false)
  })
})
