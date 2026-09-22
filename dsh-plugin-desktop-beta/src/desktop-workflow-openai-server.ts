/**
 * Optional OpenAI-compatible HTTPS/HTTP server backed by WorkflowPlugin runs.
 */

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { timingSafeEqual } from 'node:crypto'
import { isIP, type AddressInfo } from 'node:net'
import type { WorkflowPlugin } from 'dsh-plugin-workflow'
import {
  buildChatCompletionChunk,
  buildChatCompletionResponse,
  buildModelsList,
  buildRunParamsFromPrompt,
  extractRunAssistantText,
  extractUserPrompt,
  formatSseData,
  isTerminalRunStatus,
  openaiError,
  transcriptEventText,
  type OpenAiChatCompletionRequest,
} from './desktop-workflow-openai-protocol.ts'
import {
  isLoopbackHost,
  type WorkflowOpenAiApiSettings,
} from './desktop-workflow-openai-settings.ts'
import {
  ensureWorkflowOpenAiTls,
  requiresTls,
  type WorkflowOpenAiTlsMaterial,
} from './desktop-workflow-openai-tls.ts'
import {
  appendWorkflowOpenAiApiCall,
  type WorkflowOpenAiApiCallLogAppendInput,
} from './desktop-workflow-openai-call-log.ts'

export interface WorkflowOpenAiServerStatus {
  listening: boolean
  baseUrl: string | null
  usingTls: boolean
  lastError: string | null
  actualPort: number | null
}

export interface WorkflowOpenAiServerOptions {
  plugin: WorkflowPlugin
  stateDir: string
  settings: WorkflowOpenAiApiSettings
  /** Optional pre-supplied TLS (tests / Host-provided LAN leaf). */
  tls?: WorkflowOpenAiTlsMaterial
  log?: (message: string) => void
}

function safeEqualToken(expected: string, provided: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(provided)
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(a, b)
}

function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown'
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(Object.assign(new Error('request body too large'), { statusCode: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(payload)
}

function parseBearer(header: string | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(\S+)$/iu.exec(header.trim())
  return match?.[1] ?? null
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** Owns one optional OpenAI-compatible listener for workflow completions. */
export class WorkflowOpenAiServer {
  private server: Server | null = null
  private settings: WorkflowOpenAiApiSettings
  private active = 0
  private lastError: string | null = null
  private usingTls = false
  private actualPort: number | null = null

  constructor(private readonly options: WorkflowOpenAiServerOptions) {
    this.settings = options.settings
  }

  getStatus(): WorkflowOpenAiServerStatus {
    const address = this.server?.address() as AddressInfo | null
    const port = address?.port ?? this.actualPort
    const host = this.settings.bindHost
    const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
    const scheme = this.usingTls ? 'https' : 'http'
    return {
      listening: this.server?.listening === true,
      baseUrl: port ? `${scheme}://${displayHost}:${port}/v1` : null,
      usingTls: this.usingTls,
      lastError: this.lastError,
      actualPort: port ?? null,
    }
  }

  async applySettings(settings: WorkflowOpenAiApiSettings): Promise<void> {
    this.settings = settings
    await this.stop()
    if (settings.enabled) await this.start()
  }

  async start(): Promise<void> {
    await this.stop()
    this.lastError = null
    if (!this.settings.enabled) return
    if (!this.settings.apiKey) {
      this.lastError = 'API key is required when the OpenAI API server is enabled'
      throw new Error(this.lastError)
    }

    const needTls = requiresTls(this.settings.bindHost)
    let tls = this.options.tls
    if (needTls && !tls) {
      try {
        tls = await ensureWorkflowOpenAiTls(this.options.stateDir)
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error)
        throw new Error(`TLS required for non-loopback bind: ${this.lastError}`)
      }
    }
    if (needTls && !tls) {
      this.lastError = 'TLS certificate unavailable for LAN bind'
      throw new Error(this.lastError)
    }

    const handler = (req: IncomingMessage, res: ServerResponse) => {
      void this.handle(req, res)
    }

    this.usingTls = Boolean(tls)
    this.server = tls
      ? createHttpsServer({ key: tls.key, cert: tls.cert }, handler)
      : createHttpServer(handler)

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.lastError = error.message
        reject(error)
      }
      this.server!.once('error', onError)
      this.server!.listen(this.settings.port, this.settings.bindHost, () => {
        this.server!.off('error', onError)
        const addr = this.server!.address() as AddressInfo
        this.actualPort = addr.port
        this.options.log?.(
          `[workflow-openai-api] listening on ${this.usingTls ? 'https' : 'http'}://${this.settings.bindHost}:${addr.port}`,
        )
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.actualPort = null
    this.usingTls = false
    if (!server) return
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    try {
      const token = parseBearer(req.headers.authorization)
      if (!token || !safeEqualToken(this.settings.apiKey, token)) {
        this.recordCall({
          method: req.method ?? 'GET',
          path,
          clientIp: clientIp(req),
          statusCode: 401,
          ok: false,
          error: 'invalid_api_key',
        })
        writeJson(res, 401, openaiError('Invalid API key', { type: 'invalid_request_error', code: 'invalid_api_key' }))
        return
      }

      if (req.method === 'GET' && (path === '/v1/models' || path === '/models')) {
        const workflows = await this.options.plugin.listWorkflows()
        writeJson(res, 200, buildModelsList(workflows))
        return
      }

      if (req.method === 'POST' && (
        path === '/v1/chat/completions'
        || path === '/chat/completions'
      )) {
        if (this.active >= this.settings.maxConcurrent) {
          this.recordCall({
            method: 'POST',
            path,
            clientIp: clientIp(req),
            statusCode: 429,
            ok: false,
            error: 'rate_limit_exceeded',
          })
          writeJson(res, 429, openaiError('Too many concurrent workflow runs', {
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded',
          }))
          return
        }
        const raw = await readBody(req, this.settings.maxBodyBytes)
        let body: OpenAiChatCompletionRequest
        try {
          body = JSON.parse(raw) as OpenAiChatCompletionRequest
        } catch {
          this.recordCall({
            method: 'POST',
            path,
            clientIp: clientIp(req),
            statusCode: 400,
            ok: false,
            error: 'invalid_json',
          })
          writeJson(res, 400, openaiError('Invalid JSON body'))
          return
        }
        await this.handleCompletion(req, res, body, path)
        return
      }

      writeJson(res, 404, openaiError('Not found', { type: 'invalid_request_error', code: 'not_found' }))
    } catch (error) {
      const status = typeof (error as { statusCode?: number }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500
      const message = error instanceof Error ? error.message : 'internal error'
      this.options.log?.(`[workflow-openai-api] ${clientIp(req)} error: ${message}`)
      this.recordCall({
        method: req.method ?? 'GET',
        path,
        clientIp: clientIp(req),
        statusCode: status,
        ok: false,
        error: message,
      })
      if (!res.headersSent) {
        writeJson(res, status, openaiError(status >= 500 ? 'Internal server error' : message, {
          type: status >= 500 ? 'server_error' : 'invalid_request_error',
        }))
      } else {
        res.end()
      }
    }
  }

  private recordCall(input: WorkflowOpenAiApiCallLogAppendInput): void {
    void appendWorkflowOpenAiApiCall(this.options.stateDir, input).catch((error) => {
      this.options.log?.(
        `[workflow-openai-api] call log write failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
  }

  private async handleCompletion(
    req: IncomingMessage,
    res: ServerResponse,
    body: OpenAiChatCompletionRequest,
    path: string,
  ): Promise<void> {
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model) {
      this.recordCall({
        method: 'POST',
        path,
        clientIp: clientIp(req),
        statusCode: 400,
        ok: false,
        error: 'model_required',
      })
      writeJson(res, 400, openaiError('model is required', { param: 'model' }))
      return
    }

    const workflow = await this.options.plugin.getWorkflow(model)
    if (!workflow) {
      this.recordCall({
        method: 'POST',
        path,
        clientIp: clientIp(req),
        model,
        workflowName: model,
        statusCode: 404,
        ok: false,
        error: 'model_not_found',
      })
      writeJson(res, 404, openaiError(`Workflow not found: ${model}`, {
        type: 'invalid_request_error',
        code: 'model_not_found',
        param: 'model',
      }))
      return
    }

    const prompt = extractUserPrompt(body.messages)
    const workspaceHeader = req.headers['x-dsh-workspace']
    const workspaceId = typeof body.workspace === 'string' && body.workspace.trim()
      ? body.workspace.trim()
      : (typeof workspaceHeader === 'string' ? workspaceHeader.trim() : undefined)
    const params = {
      ...buildRunParamsFromPrompt(prompt, workspaceId),
      source: 'openai-api',
    }

    this.active += 1
    const started = Date.now()
    let runId: string | undefined
    let statusCode = 500
    let ok = false
    let errorText: string | undefined
    try {
      const run = workspaceId
        ? await this.options.plugin.startBoundRun(workspaceId, params).catch(async (error) => {
          // Fall back to named start when no binding exists.
          this.options.log?.(
            `[workflow-openai-api] startBoundRun failed (${String(error)}); using startRun(${model})`,
          )
          return this.options.plugin.startRun(model, params)
        })
        : await this.options.plugin.startRun(model, params)
      runId = run.id

      this.options.log?.(
        `[workflow-openai-api] ${clientIp(req)} start run=${run.id} workflow=${model}`,
      )

      if (body.stream) {
        await this.streamRun(res, model, run.id)
        statusCode = 200
        ok = true
      } else {
        const finished = await this.waitForRun(run.id)
        const transcript = await this.options.plugin.getTranscript(run.id, { limit: 500 })
        const content = extractRunAssistantText(finished, transcript.events ?? [])
        if (finished.status !== 'completed') {
          statusCode = 502
          errorText = finished.error ?? `Workflow ended with status ${finished.status}`
          writeJson(res, 502, openaiError(
            errorText,
            { type: 'server_error', code: finished.status },
          ))
          return
        }
        statusCode = 200
        ok = true
        writeJson(res, 200, buildChatCompletionResponse({
          id: `chatcmpl-${run.id}`,
          model,
          content,
          created: Math.floor(started / 1000),
        }))
      }
    } catch (error) {
      statusCode = typeof (error as { statusCode?: number }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500
      errorText = error instanceof Error ? error.message : 'internal error'
      this.options.log?.(`[workflow-openai-api] ${clientIp(req)} completion error: ${errorText}`)
      if (!res.headersSent) {
        writeJson(res, statusCode, openaiError(statusCode >= 500 ? 'Internal server error' : errorText, {
          type: statusCode >= 500 ? 'server_error' : 'invalid_request_error',
        }))
      }
    } finally {
      this.active = Math.max(0, this.active - 1)
      this.recordCall({
        method: 'POST',
        path,
        clientIp: clientIp(req),
        model,
        workflowName: model,
        statusCode,
        ok,
        durationMs: Date.now() - started,
        stream: Boolean(body.stream),
        ...(runId ? { runId } : {}),
        ...(errorText ? { error: errorText } : {}),
      })
    }
  }

  private async waitForRun(runId: string) {
    for (;;) {
      const run = await this.options.plugin.getRun(runId)
      if (!run) throw new Error(`Run disappeared: ${runId}`)
      if (isTerminalRunStatus(run.status)) return run
      await sleep(250)
    }
  }

  private async streamRun(res: ServerResponse, model: string, runId: string): Promise<void> {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const id = `chatcmpl-${runId}`
    const created = Math.floor(Date.now() / 1000)
    let cursor: string | undefined
    let sawTerminal = false

    res.write(formatSseData(buildChatCompletionChunk({
      id,
      model,
      delta: '',
      created,
    })))

    while (!sawTerminal) {
      const page = await this.options.plugin.getTranscript(runId, {
        ...(cursor ? { after: cursor } : {}),
        limit: 100,
      })
      for (const event of page.events ?? []) {
        const text = transcriptEventText(event)
        if (text) {
          res.write(formatSseData(buildChatCompletionChunk({
            id,
            model,
            delta: text,
            created,
          })))
        }
      }
      if (page.nextAfter) cursor = page.nextAfter

      const run = await this.options.plugin.getRun(runId)
      if (run && isTerminalRunStatus(run.status)) {
        sawTerminal = true
        if (run.status !== 'completed' && run.error) {
          res.write(formatSseData(buildChatCompletionChunk({
            id,
            model,
            delta: `\n[error] ${run.error}`,
            created,
          })))
        }
        res.write(formatSseData(buildChatCompletionChunk({
          id,
          model,
          delta: '',
          finishReason: run.status === 'completed' ? 'stop' : 'stop',
          created,
        })))
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      await sleep(250)
    }
  }
}

export function assertSafeBindHost(host: string): void {
  if (isLoopbackHost(host)) return
  if (host === '0.0.0.0' || host === '::') return
  if (isIP(host)) return
  throw new Error(`Unsupported bind host: ${host}`)
}
