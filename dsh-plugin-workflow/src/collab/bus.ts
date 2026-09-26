/** In-process CollabBus pub/sub — V2 bridges to AspBridge (in-process loopback or external TCP later) */

import { randomUUID } from 'node:crypto'
import type { CollabEnvelope, CollabPayload } from './types.js'

export type CollabBusHandler = (envelope: CollabEnvelope) => void

export interface AspBridge {
  send(envelope: CollabEnvelope): Promise<void>
  close?(): Promise<void>
}

export type AspBridgeMode = 'in-process' | 'external' | 'disconnected'

export interface AspBridgeStatus {
  mode: AspBridgeMode
  endpoint?: string
  lastError?: string
}

export class CollabBus {
  private handlers = new Set<CollabBusHandler>()
  private aspBridge: AspBridge | undefined

  constructor(aspBridge?: AspBridge) {
    this.aspBridge = aspBridge
  }

  subscribe(handler: CollabBusHandler): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  setAspBridge(bridge: AspBridge | undefined): void {
    this.aspBridge = bridge
  }

  getAspBridge(): AspBridge | undefined {
    return this.aspBridge
  }

  /** Deliver to in-process subscribers only (no AspBridge re-entry). */
  deliverLocal(envelope: CollabEnvelope): void {
    for (const handler of this.handlers) {
      handler(envelope)
    }
  }

  send(input: {
    from_jid: string
    to_jid: string
    payload: CollabPayload
    id?: string
    timestamp?: string
  }): CollabEnvelope {
    const envelope: CollabEnvelope = {
      id: input.id ?? randomUUID(),
      from_jid: input.from_jid,
      to_jid: input.to_jid,
      timestamp: input.timestamp ?? new Date().toISOString(),
      payload: input.payload,
    }
    this.deliverLocal(envelope)
    const bridge = this.aspBridge
    if (bridge) {
      void bridge.send(envelope).catch(() => {
        // fire-and-forget; Host may surface bridge errors via asp.status
      })
    }
    return envelope
  }
}

/** Loopback AspBridge — republishes envelopes on the same bus (tests + Host default). */
export function createInProcessAspBridge(bus: CollabBus): AspBridge {
  return {
    async send(envelope: CollabEnvelope): Promise<void> {
      bus.deliverLocal(envelope)
    },
  }
}

/** Test / placeholder external bridge — records envelopes without wire I/O. */
export class StubAspBridge implements AspBridge {
  readonly sent: CollabEnvelope[] = []

  async send(envelope: CollabEnvelope): Promise<void> {
    this.sent.push(envelope)
  }
}
