/** In-process CollabBus pub/sub — V2 bridges to AspBridge (in-process / external TCP|TLS + ASP protobuf) */

import { randomUUID } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'
import { connect as tlsConnect, type ConnectionOptions as TlsConnectionOptions, type TLSSocket } from 'node:tls'
import {
  decodeAgentStreamMessage,
  decodeAuthResponseMessage,
  encodeAgentStreamMessage,
  encodeAuthRequestMessage,
  frameAspPayload,
} from './asp-proto.js'
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
  tls?: boolean
  codec?: AspWireCodec
  authenticated?: boolean
}

export type AspWireCodec = 'protobuf' | 'json'

export interface AspTlsOptions {
  /** PEM CA bundle path or inline PEM; omit for system trust store. */
  ca?: string | Buffer
  cert?: string | Buffer
  key?: string | Buffer
  servername?: string
  rejectUnauthorized?: boolean
}

export interface AspAuthOptions {
  jid: string
  password: string
  mechanism?: 'PLAIN'
}

export interface AspBridgeOptions {
  onError?: (message: string) => void
  /** Deliver inbound ASP envelopes (after auth) to Host/bus. */
  onInbound?: (envelope: CollabEnvelope) => void
  /** Default `protobuf` (ASP AgentStreamMessage). `json` kept for interim tests. */
  codec?: AspWireCodec
  tls?: boolean | AspTlsOptions
  auth?: AspAuthOptions
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

export interface ParsedAspEndpoint {
  host: string
  port: number
  tls: boolean
}

export function parseAspTcpEndpoint(endpoint: string): ParsedAspEndpoint {
  const trimmed = endpoint.trim()
  let tls = false
  let rest = trimmed
  if (/^tls:\/\//i.test(rest)) {
    tls = true
    rest = rest.replace(/^tls:\/\//i, '')
  } else if (/^tcp:\/\//i.test(rest)) {
    rest = rest.replace(/^tcp:\/\//i, '')
  } else if (/^ssl:\/\//i.test(rest)) {
    tls = true
    rest = rest.replace(/^ssl:\/\//i, '')
  }
  const hostPort = rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : rest
  const lastColon = hostPort.lastIndexOf(':')
  if (lastColon <= 0) {
    throw new Error(`Invalid ASP TCP endpoint (expected [tls://]host:port): ${endpoint}`)
  }
  const host = hostPort.slice(0, lastColon)
  const port = Number(hostPort.slice(lastColon + 1))
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ASP TCP endpoint (expected [tls://]host:port): ${endpoint}`)
  }
  return { host, port, tls }
}

type AspSocket = Socket | TLSSocket

/**
 * External AspBridge: length-prefixed ASP AgentStreamMessage (protobuf) over TCP or TLS.
 * Optional PLAIN auth handshake matches Python AgentClient / Rust ASP server.
 */
export class TcpFramedAspBridge implements AspBridge {
  readonly endpoint: string
  readonly codec: AspWireCodec
  readonly useTls: boolean
  private readonly options: AspBridgeOptions
  private socket: AspSocket | undefined
  private connecting: Promise<void> | undefined
  private buffer = Buffer.alloc(0)
  private awaitingAuth = false
  private authResolve: ((ok: boolean) => void) | undefined
  private authReject: ((err: Error) => void) | undefined
  lastError: string | undefined
  authenticated = false

  constructor(endpoint: string, options: AspBridgeOptions | ((message: string) => void) = {}) {
    this.endpoint = endpoint
    this.options = typeof options === 'function' ? { onError: options } : options
    this.codec = this.options.codec ?? 'protobuf'
    const parsed = parseAspTcpEndpoint(endpoint)
    this.useTls = Boolean(this.options.tls) || parsed.tls
  }

  private fail(message: string): void {
    this.lastError = message
    this.options.onError?.(message)
  }

  private writeFrame(payload: Buffer): Promise<void> {
    const socket = this.socket
    if (!socket || socket.destroyed) {
      const message = `ASP bridge disconnected: ${this.endpoint}`
      this.fail(message)
      return Promise.reject(new Error(message))
    }
    const frame = frameAspPayload(payload)
    return new Promise((resolve, reject) => {
      socket.write(frame, (err) => {
        if (err) {
          this.fail(err.message)
          reject(err)
          return
        }
        resolve()
      })
    })
  }

  private handleFrame(payload: Buffer): void {
    if (this.awaitingAuth) {
      const auth = decodeAuthResponseMessage(payload)
      this.awaitingAuth = false
      if (auth?.success) {
        this.authenticated = true
        this.authResolve?.(true)
      } else {
        const message = auth?.error_message ?? 'ASP authentication failed'
        this.fail(message)
        this.authReject?.(new Error(message))
      }
      this.authResolve = undefined
      this.authReject = undefined
      return
    }
    if (this.codec === 'json') {
      try {
        const envelope = JSON.parse(payload.toString('utf8')) as CollabEnvelope
        this.options.onInbound?.(envelope)
      } catch (err) {
        this.fail(err instanceof Error ? err.message : String(err))
      }
      return
    }
    try {
      const envelope = decodeAgentStreamMessage(payload)
      if (envelope) this.options.onInbound?.(envelope)
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err))
    }
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.buffer.length >= 4) {
      const len = this.buffer.readUInt32BE(0)
      if (len > 16 * 1024 * 1024) {
        this.fail(`ASP frame too large: ${len}`)
        this.buffer = Buffer.alloc(0)
        break
      }
      if (this.buffer.length < 4 + len) break
      const payload = this.buffer.subarray(4, 4 + len)
      this.buffer = this.buffer.subarray(4 + len)
      this.handleFrame(payload)
    }
  }

  private async openSocket(): Promise<AspSocket> {
    const { host, port, tls: endpointTls } = parseAspTcpEndpoint(this.endpoint)
    const wantTls = this.useTls || endpointTls
    if (!wantTls) {
      return new Promise((resolve, reject) => {
        const socket = createConnection({ host, port }, () => resolve(socket))
        socket.once('error', reject)
      })
    }
    const tlsOpt = typeof this.options.tls === 'object' ? this.options.tls : {}
    const tlsOptions: TlsConnectionOptions = {
      host,
      port,
      servername: tlsOpt.servername ?? host,
      rejectUnauthorized: tlsOpt.rejectUnauthorized ?? true,
    }
    if (tlsOpt.ca !== undefined) tlsOptions.ca = tlsOpt.ca
    if (tlsOpt.cert !== undefined) tlsOptions.cert = tlsOpt.cert
    if (tlsOpt.key !== undefined) tlsOptions.key = tlsOpt.key
    return new Promise((resolve, reject) => {
      const socket = tlsConnect(tlsOptions, () => resolve(socket))
      socket.once('error', reject)
    })
  }

  private async authenticate(): Promise<void> {
    const auth = this.options.auth
    if (!auth) {
      this.authenticated = false
      return
    }
    if ((auth.mechanism ?? 'PLAIN') !== 'PLAIN') {
      throw new Error(`Unsupported ASP auth mechanism: ${auth.mechanism}`)
    }
    this.awaitingAuth = true
    const authWait = new Promise<boolean>((resolve, reject) => {
      this.authResolve = resolve
      this.authReject = reject
    })
    const payload = encodeAuthRequestMessage({
      id: randomUUID(),
      from_jid: auth.jid,
      password: auth.password,
    })
    await this.writeFrame(payload)
    const ok = await Promise.race([
      authWait,
      new Promise<boolean>((_, reject) => {
        setTimeout(() => reject(new Error('ASP authentication timed out')), 10_000)
      }),
    ])
    if (!ok) throw new Error('ASP authentication failed')
  }

  async connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return
    if (this.connecting) return this.connecting
    this.connecting = (async () => {
      try {
        const socket = await this.openSocket()
        this.socket = socket
        this.buffer = Buffer.alloc(0)
        this.lastError = undefined
        this.authenticated = false
        socket.on('data', (chunk) => this.onData(chunk))
        socket.on('error', (err) => {
          this.fail(err.message)
        })
        socket.on('close', () => {
          this.socket = undefined
          this.authenticated = false
        })
        await this.authenticate()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.fail(message)
        try {
          this.socket?.destroy()
        } catch {
          // ignore
        }
        this.socket = undefined
        throw err instanceof Error ? err : new Error(message)
      } finally {
        this.connecting = undefined
      }
    })()
    return this.connecting
  }

  async send(envelope: CollabEnvelope): Promise<void> {
    await this.connect()
    const payload = this.codec === 'json'
      ? Buffer.from(JSON.stringify(envelope), 'utf8')
      : encodeAgentStreamMessage(envelope)
    await this.writeFrame(payload)
  }

  async close(): Promise<void> {
    const socket = this.socket
    this.socket = undefined
    this.connecting = undefined
    this.authenticated = false
    this.awaitingAuth = false
    this.authResolve = undefined
    this.authReject = undefined
    if (!socket || socket.destroyed) return
    await new Promise<void>((resolve) => {
      socket.end(() => resolve())
    })
  }
}

export function createTcpFramedAspBridge(
  endpoint: string,
  options?: AspBridgeOptions | ((message: string) => void),
): TcpFramedAspBridge {
  return new TcpFramedAspBridge(endpoint, options)
}
