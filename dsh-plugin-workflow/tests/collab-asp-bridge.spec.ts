/**
 * CollabBus AspBridge wiring — in-process loopback and external stub recording.
 */

import { describe, expect, it } from 'vitest'
import {
  CollabBus,
  StubAspBridge,
  createInProcessAspBridge,
} from '../src/collab/bus.js'

describe('CollabBus AspBridge', () => {
  it('send via in-process bridge reaches a subscriber', () => {
    const bus = new CollabBus()
    bus.setAspBridge(createInProcessAspBridge(bus))
    const received: string[] = []
    bus.subscribe((envelope) => {
      received.push(envelope.id)
    })
    const envelope = bus.send({
      from_jid: 'admin@desktop.local/control',
      to_jid: 'session@desktop.local/ses-1',
      payload: { kind: 'message', body: 'hello' },
    })
    expect(received).toEqual([envelope.id, envelope.id])
  })

  it('external stub records envelopes sent through the bus bridge', async () => {
    const bus = new CollabBus()
    const stub = new StubAspBridge()
    bus.setAspBridge(stub)
    bus.send({
      from_jid: 'agent@desktop.local/a1',
      to_jid: 'admin@desktop.local/control',
      payload: { kind: 'iq', name: 'vision.get' },
    })
    await Promise.resolve()
    expect(stub.sent).toHaveLength(1)
    expect(stub.sent[0]?.payload).toEqual({ kind: 'iq', name: 'vision.get' })
  })

  it('setAspBridge and getAspBridge round-trip', () => {
    const bus = new CollabBus()
    expect(bus.getAspBridge()).toBeUndefined()
    const stub = new StubAspBridge()
    bus.setAspBridge(stub)
    expect(bus.getAspBridge()).toBe(stub)
    bus.setAspBridge(undefined)
    expect(bus.getAspBridge()).toBeUndefined()
  })
})
