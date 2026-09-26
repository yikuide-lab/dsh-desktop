/** In-process CollabBus pub/sub — V2 may bridge to AspBridge */

import { randomUUID } from 'node:crypto'
import type { CollabEnvelope, CollabPayload } from './types.js'

export type CollabBusHandler = (envelope: CollabEnvelope) => void

export interface AspBridge {
  send(envelope: CollabEnvelope): Promise<void>
  close?(): Promise<void>
}

export class CollabBus {
  private handlers = new Set<CollabBusHandler>()

  subscribe(handler: CollabBusHandler): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
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
    for (const handler of this.handlers) {
      handler(envelope)
    }
    return envelope
  }
}

/** V1 stub — real ASP wire deferred to V2 */
export class StubAspBridge implements AspBridge {
  async send(_envelope: CollabEnvelope): Promise<void> {
    throw new Error('AspBridge not implemented in V1')
  }
}
