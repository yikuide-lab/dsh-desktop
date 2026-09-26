/** In-process CollabBus pub/sub — V2 bridges to AspBridge (in-process loopback or external TCP) */

import { createConnection, type Socket } from 'node:net'
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
    sender_did?: string
  }): CollabEnvelope {
    const envelope: CollabEnvelope = {
      id: input.id ?? randomUUID(),
      from_jid: input.from_jid,
      to_jid: input.to_jid,
      timestamp: input.timestamp ?? new Date().toISOString(),
      payload: input.payload,
      ...(input.sender_did !== undefined ? { sender_did: input.sender_did } : {}),
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

export function parseAspTcpEndpoint(endpoint: string): { host: string; port: number } {
  const trimmed = endpoint.trim()
  const withoutScheme = trimmed.replace(/^tcp:\/\//i, '')
  const hostPort = withoutScheme.includes('/')
    ? withoutScheme.slice(0, withoutScheme.indexOf('/'))
    : withoutScheme
  const lastColon = hostPort.lastIndexOf(':')
  if (lastColon <= 0) {
    throw new Error(`Invalid ASP TCP endpoint (expected host:port): ${endpoint}`)
  }
  const host = hostPort.slice(0, lastColon)
  const port = Number(hostPort.slice(lastColon + 1))
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ASP TCP endpoint (expected host:port): ${endpoint}`)
  }
  return { host, port }
}

/**
 * Interim external AspBridge: length-prefixed (u32 BE) JSON CollabEnvelope over TCP.
 * Protobuf ASP wire remains a follow-up; this unblocks Host `external` mode + endpoint tests.
 */
export class TcpFramedAspBridge implements AspBridge {
  readonly endpoint: string
  private readonly onError?: (message: string) => void
  private socket: Socket | undefined
  private connecting: Promise<void> | undefined
  private buffer = Buffer.alloc(0)
  lastError: string | undefined

  constructor(endpoint: string, onError?: (message: string) => void) {
    this.endpoint = endpoint
    this.onError = onError
  }

  private fail(message: string): void {
    this.lastError = message
    this.onError?.(message)
  }

  async connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return
    if (this.connecting) return this.connecting
    const { host, port } = parseAspTcpEndpoint(this.endpoint)
    this.connecting = new Promise((resolve, reject) => {
      const socket = createConnection({ host, port }, () => {
        this.socket = socket
        this.lastError = undefined
        this.connecting = undefined
        resolve()
      })
      socket.on('data', (chunk) => {
        this.buffer = Buffer.concat([this.buffer, chunk])
        // Receiver side reserved for inbound ASP; drain frames without interpreting yet.
        while (this.buffer.length >= 4) {
          const len = this.buffer.readUInt32BE(0)
          if (this.buffer.length < 4 + len) break
          this.buffer = this.buffer.subarray(4 + len)
        }
      })
      socket.on('error', (err) => {
        this.fail(err.message)
        this.connecting = undefined
        reject(err)
      })
      socket.on('close', () => {
        this.socket = undefined
      })
    })
    return this.connecting
  }

  async send(envelope: CollabEnvelope): Promise<void> {
    try {
      await this.connect()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.fail(message)
      throw err instanceof Error ? err : new Error(message)
    }
    const socket = this.socket
    if (!socket || socket.destroyed) {
      const message = `ASP TCP bridge disconnected: ${this.endpoint}`
      this.fail(message)
      throw new Error(message)
    }
    const body = Buffer.from(JSON.stringify(envelope), 'utf8')
    const header = Buffer.alloc(4)
    header.writeUInt32BE(body.length, 0)
    await new Promise<void>((resolve, reject) => {
      socket.write(Buffer.concat([header, body]), (err) => {
        if (err) {
          this.fail(err.message)
          reject(err)
          return
        }
        resolve()
      })
    })
  }

  async close(): Promise<void> {
    const socket = this.socket
    this.socket = undefined
    this.connecting = undefined
    if (!socket || socket.destroyed) return
    await new Promise<void>((resolve) => {
      socket.end(() => resolve())
    })
  }
}

export function createTcpFramedAspBridge(
  endpoint: string,
  onError?: (message: string) => void,
): TcpFramedAspBridge {
  return new TcpFramedAspBridge(endpoint, onError)
}
