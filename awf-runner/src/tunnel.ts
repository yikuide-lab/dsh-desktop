/**
 * AWF tunnel client — connects to wss://host/api/tunnel/ws with executor
 * token and runs the frame protocol, exposing a local OpenAI-compatible
 * HTTP server (default :8787) for workloads.
 *
 * Frame protocol (Phase 3a):
 *  - platform→node: {type:"request", id, method, path, headers, body_b64}
 *  - node→platform: {type:"response", id, status, headers, body_b64, done} (streaming = multiple done:false then done:true)
 *  - node→platform: {type:"error", id, message}
 *  - ping/pong: platform pings every 30s, read deadline 90s (gorilla handles pong)
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'
import type { AwfFetch } from './awf/client.js'
import type { AwfSettings } from './awf/settings.js'
import { awfExecutorCredentialsPath } from './awf/executor.js'
import { readFile } from 'node:fs/promises'

export type TunnelFrame =
  | { type: 'request'; id: string; method: string; path: string; headers: Record<string, string>; body_b64: string }
  | { type: 'response'; id: string; status: number; headers: Record<string, string>; body_b64: string; done: boolean }
  | { type: 'error'; id: string; message: string }
  | { type: 'ping' }
  | { type: 'pong' }

export interface TunnelClientOptions {
  /** State directory (where awf.json, awf-executor.json live). */
  readonly stateDir: string
  /** Local port to serve OpenAI-compatible endpoint (default 8787). */
  readonly localPort?: number
  /** Logger. */
  readonly log?: (message: string) => void
  /** Test seams. */
  readonly fetchImpl?: AwfFetch
  readonly env?: Record<string, string | undefined>
  readonly wsImpl?: typeof WebSocket
}

export interface TunnelClientHandle {
  /** Start the tunnel (connect WS, start local HTTP server). */
  start(): Promise<void>
  /** Stop the tunnel (close WS, close HTTP server). */
  stop(): Promise<void>
  /** Current status. */
  status(): TunnelClientStatus
}

export interface TunnelClientStatus {
  readonly connected: boolean
  readonly localPort: number
  readonly executorId: number | null
  readonly since: string | null
  readonly error: string | null
}

function base64Encode(input: string | Uint8Array): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input)
  return buf.toString('base64')
}

function base64Decode(input: string): Buffer {
  return Buffer.from(input, 'base64')
}

export function createTunnelClient(options: TunnelClientOptions): TunnelClientHandle {
  const log = options.log ?? ((): void => {})
  const localPort = options.localPort ?? 8787
  const doFetch = options.fetchImpl ?? fetch
  const wsImpl = options.wsImpl ?? WebSocket
  const stateDir = options.stateDir
  const env = options.env ?? process.env

  let ws: WebSocket | null = null
  let httpServer: ReturnType<typeof createServer> | null = null
  let connecting = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let since: string | null = null
  let lastError: string | null = null
  let executorId: number | null = null
  const pending = new Map<string, { resolve: (value: { status: number; headers: Record<string, string>; body: Buffer; done: boolean }) => void; reject: (error: Error) => void }>()

  function credentialsPath(): string {
    return awfExecutorCredentialsPath(stateDir)
  }

  async function readExecutorCredentials(): Promise<{ executorId: number; token: string } | null> {
    try {
      const raw = await readFile(credentialsPath(), 'utf8')
      const parsed = JSON.parse(raw) as { executorId?: number; token?: string }
      if (typeof parsed.executorId === 'number' && typeof parsed.token === 'string' && parsed.token) {
        return { executorId: parsed.executorId, token: parsed.token }
      }
      return null
    } catch {
      return null
    }
  }

  async function getSettings(): Promise<AwfSettings> {
    // Import settings module dynamically to avoid circular deps
    const { readAwfSettings } = await import('./awf/settings.js')
    return readAwfSettings(stateDir)
  }

  async function getBaseUrl(): Promise<string> {
    const settings = await getSettings()
    return settings.baseUrl.replace(/\/+$/, '')
  }

  async function connect(): Promise<void> {
    if (connecting) return
    connecting = true
    const creds = await readExecutorCredentials()
    if (!creds) {
      connecting = false
      lastError = 'executor not registered (run awf-node serve first)'
      log(`[tunnel] ${lastError}`)
      scheduleReconnect()
      return
    }
    executorId = creds.executorId
    const baseUrl = await getBaseUrl()
    const wsUrl = baseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/api/tunnel/ws'

    log(`[tunnel] connecting to ${wsUrl} as executor #${creds.executorId}`)

    ws = new wsImpl(wsUrl, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })

    ws.on('open', () => {
      connecting = false
      since = new Date().toISOString()
      lastError = null
      log(`[tunnel] connected`)
    })

    ws.on('message', (data: Buffer) => {
      try {
        const frame = JSON.parse(data.toString('utf8')) as TunnelFrame
        handleFrame(frame)
      } catch (error) {
        log(`[tunnel] invalid frame: ${error instanceof Error ? error.message : String(error)}`)
      }
    })

    ws.on('close', (code, reason) => {
      connecting = false
      log(`[tunnel] disconnected: ${code} ${reason.toString()}`)
      since = null
      // Reject all pending
      for (const [, v] of pending) v.reject(new Error(`WS closed: ${code} ${reason.toString()}`))
      pending.clear()
      if (code !== 1000) scheduleReconnect()
    })

    ws.on('error', (error) => {
      lastError = error.message
      log(`[tunnel] error: ${error.message}`)
    })
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void connect()
    }, 5000)
  }

  function handleFrame(frame: TunnelFrame): void {
    if (frame.type === 'request') {
      void handleRequest(frame)
    } else if (frame.type === 'ping') {
      // Respond with pong
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'pong' }))
    }
    // Ignore other frame types from platform
  }

  async function handleRequest(frame: TunnelFrame & { type: 'request' }): Promise<void> {
    const { id, method, path, headers, body_b64 } = frame
    try {
      // Forward to local engine? No — this tunnel client is for the NODE side.
      // The NODE side receives the request, executes it locally, and sends response.
      // For awf-runner, we need to execute the task via the local workflow engine.
      // But this is a generic tunnel client — it should forward to whatever local
      // HTTP endpoint is configured. Let's make it configurable.
      // For now, we implement a simple proxy to a local target URL.
      const targetBase = env.AWF_NODE_TUNNEL_TARGET ?? 'http://127.0.0.1:8788'
      const url = new URL(path, targetBase)
      const body = base64Decode(body_b64)

      const reqHeaders: Record<string, string> = {}
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v === 'string') reqHeaders[k.toLowerCase()] = v
      }
      // Don't forward host/connection headers
      delete reqHeaders.host
      delete reqHeaders.connection

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 600_000)

      let response: Response
      try {
        response = await doFetch(url.toString(), {
          method: method,
          headers: reqHeaders,
          body: body.length > 0 ? body : undefined,
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }

      const resHeaders: Record<string, string> = {}
      for (const [k, v] of response.headers.entries()) {
        resHeaders[k] = v
      }

      const isStream = headers['accept']?.includes('text/event-stream') ||
                       path.includes('/chat/completions') && resHeaders['content-type']?.includes('text/event-stream')

      if (isStream) {
        // Streaming response: send chunks as separate frames
        const reader = response.body?.getReader()
        if (!reader) throw new Error('no response body')
        let first = true
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            await sendFrame({ type: 'response', id, status: response.status, headers: resHeaders, body_b64: '', done: true })
            break
          }
          if (first) {
            // First chunk: send status + headers
            await sendFrame({ type: 'response', id, status: response.status, headers: resHeaders, body_b64: base64Encode(value), done: false })
            first = false
          } else {
            await sendFrame({ type: 'response', id, status: response.status, headers: {}, body_b64: base64Encode(value), done: false })
          }
        }
      } else {
        // Non-streaming: collect full body
        const bodyBuf = Buffer.from(await response.arrayBuffer())
        await sendFrame({ type: 'response', id, status: response.status, headers: resHeaders, body_b64: base64Encode(bodyBuf), done: true })
      }
    } catch (error) {
      await sendFrame({ type: 'error', id, message: error instanceof Error ? error.message : String(error) })
    }
  }

  async function sendFrame(frame: Exclude<TunnelFrame, { type: 'request' }>): Promise<void> {
    if (ws?.readyState !== WebSocket.OPEN) {
      throw new Error('WS not connected')
    }
    ws.send(JSON.stringify(frame))
  }

  async function sendRequestFrame(frame: TunnelFrame & { type: 'request' }): Promise<void> {
    if (ws?.readyState !== WebSocket.OPEN) {
      throw new Error('WS not connected')
    }
    ws.send(JSON.stringify(frame))
  }

  // Local HTTP server for OpenAI-compatible endpoint
  async function startHttpServer(): Promise<void> {
    httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // Only accept requests on the configured port
      // Transform incoming request to tunnel frame and wait for response
      const correlationId = randomUUID()
      const url = new URL(req.url ?? '/', `http://localhost:${localPort}`)
      const bodyChunks: Buffer[] = []
      for await (const chunk of req) bodyChunks.push(chunk)
      const bodyBuf = Buffer.concat(bodyChunks)
      const body_b64 = base64Encode(bodyBuf)

      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers[k] = v
      }

      const frame: TunnelFrame = {
        type: 'request',
        id: correlationId,
        method: req.method ?? 'POST',
        path: url.pathname + url.search,
        headers,
        body_b64,
      }

      // Send frame and wait for response
      if (ws?.readyState !== WebSocket.OPEN) {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'tunnel not connected' }))
        return
      }

      await sendRequestFrame(frame)

      // Wait for response frames
      try {
        const result = await new Promise<{ status: number; headers: Record<string, string>; body: Buffer; done: boolean }>((resolve, reject) => {
          pending.set(correlationId, { resolve, reject })
          // Timeout
          setTimeout(() => {
            if (pending.has(correlationId)) {
              pending.delete(correlationId)
              reject(new Error('request timeout'))
            }
          }, 600_000)
        })

        // Send response
        res.writeHead(result.status, result.headers)
        res.end(result.body)
      } catch (error) {
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      }
    })

    return new Promise((resolve) => {
      httpServer!.listen(localPort, () => {
        log(`[tunnel] local HTTP server listening on ${localPort}`)
        resolve()
      })
    })
  }

  async function stopHttpServer(): Promise<void> {
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()))
      httpServer = null
    }
  }

  return {
    async start() {
      await startHttpServer()
      await connect()
    },
    async stop() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (ws) {
        ws.close(1000, 'client shutdown')
        ws = null
      }
      await stopHttpServer()
      since = null
      executorId = null
    },
    status() {
      return {
        connected: ws?.readyState === WebSocket.OPEN,
        localPort,
        executorId,
        since,
        error: lastError,
      }
    },
  }
}