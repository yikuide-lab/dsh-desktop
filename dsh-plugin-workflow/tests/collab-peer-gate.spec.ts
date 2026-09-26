import { describe, expect, it } from 'vitest'
import {
  buildCollabJoinGate,
  collabPeerNeedsJoinGate,
  createRun,
  dispatchTask,
  resolveCollabJoinGate,
} from '../src/engine/engine.ts'
import {
  StepType,
  TaskStatus,
  validateWorkflow,
  type Workflow,
} from '../src/engine/models.ts'

function openSlotWorkflow(slot = 'reviewer'): Workflow {
  return {
    apiVersion: 'workflow-wise/v1',
    kind: 'Workflow',
    metadata: { name: 'collab-open' },
    spec: {
      steps: [{
        id: 'peer',
        type: StepType.CollabPeer,
        peer: {
          kind: 'session',
          slot,
          role: 'reviewer',
        },
      }],
    },
  }
}

function staticJidWorkflow(): Workflow {
  return {
    apiVersion: 'workflow-wise/v1',
    kind: 'Workflow',
    metadata: { name: 'collab-static' },
    spec: {
      steps: [{
        id: 'peer',
        type: StepType.CollabPeer,
        peer: {
          kind: 'session',
          jid: 'session@desktop.local/ses-1',
          open: false,
        },
      }],
    },
  }
}

describe('collab_peer join gate', () => {
  it('open slot creates collab_join gate; resolve leaves Pending; then can dispatch', () => {
    const workflow = openSlotWorkflow('slot-a')
    const run = createRun(workflow)
    const gate = run.gates.peer

    expect(gate).toBeDefined()
    expect(gate?.kind).toBe('collab_join')
    expect(gate?.options).toEqual(['joined'])
    expect(gate?.pass).toEqual(['joined'])
    expect(gate?.question).toContain('slot-a')
    expect(run.tasks.peer?.status).toBe(TaskStatus.Pending)

    const resolved = resolveCollabJoinGate(run, 'peer', gate!.token!, 'host')
    expect(resolved.gates.peer?.resolved).toBe('joined')
    expect(resolved.tasks.peer?.status).toBe(TaskStatus.Pending)

    const { run: dispatched, dispatchId } = dispatchTask(resolved, 'peer', 4)
    expect(dispatchId).toBeTruthy()
    expect(dispatched.tasks.peer?.status).toBe(TaskStatus.InProgress)
  })

  it('static jid peer creates no gate on createRun', () => {
    const workflow = staticJidWorkflow()
    const run = createRun(workflow)

    expect(run.gates.peer).toBeUndefined()
    expect(collabPeerNeedsJoinGate(workflow.spec.steps[0]!)).toBe(false)

    const { run: dispatched } = dispatchTask(run, 'peer', 4)
    expect(dispatched.tasks.peer?.status).toBe(TaskStatus.InProgress)
  })

  it('buildCollabJoinGate falls back to step id when slot omitted at runtime', () => {
    const step = {
      id: 'peer-x',
      type: StepType.CollabPeer,
      peer: { kind: 'agent' as const },
    }
    expect(buildCollabJoinGate(step).question).toBe('Waiting for peer join (slot=peer-x)')
  })

  it('rejects invalid token and double resolve', () => {
    const run = createRun(openSlotWorkflow())
    const token = run.gates.peer!.token!

    expect(() => resolveCollabJoinGate(run, 'peer', 'bad-token', 'host'))
      .toThrow(/Invalid gate token/)

    const once = resolveCollabJoinGate(run, 'peer', token, 'host')
    expect(() => resolveCollabJoinGate(once, 'peer', token, 'host'))
      .toThrow(/already resolved/)
  })
})

describe('collab_peer validation', () => {
  it('open peer without slot fails validation', () => {
    const result = validateWorkflow({
      apiVersion: 'workflow-wise/v1',
      kind: 'Workflow',
      metadata: { name: 'bad-open' },
      spec: {
        steps: [{
          id: 'peer',
          type: StepType.CollabPeer,
          peer: { kind: 'session' },
        }],
      },
    })
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.path.endsWith('peer.slot'))).toBe(true)
  })

  it('closed peer without jid fails validation', () => {
    const result = validateWorkflow({
      apiVersion: 'workflow-wise/v1',
      kind: 'Workflow',
      metadata: { name: 'bad-closed' },
      spec: {
        steps: [{
          id: 'peer',
          type: StepType.CollabPeer,
          peer: { kind: 'agent', open: false, slot: 'ignored' },
        }],
      },
    })
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.path.endsWith('peer.jid'))).toBe(true)
  })

  it('accepts requires collab capability', () => {
    const caps = validateWorkflow({
      apiVersion: 'workflow-wise/v1',
      kind: 'Workflow',
      metadata: { name: 'cap', requires: ['collab'] },
      spec: {
        steps: [{
          id: 'peer',
          type: StepType.CollabPeer,
          peer: { kind: 'workflow', slot: 'wf-slot' },
        }],
      },
    })
    expect(caps.ok).toBe(true)
  })
})
