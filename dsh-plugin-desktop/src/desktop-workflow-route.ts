/** Strict loopback HTTP handler for the private Desktop workflow API. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WorkflowPlugin } from 'dsh-plugin-workflow'
import {
  DESKTOP_WORKFLOW_PATH,
  type DesktopWorkflowErrorResponse,
  type DesktopWorkflowOp,
  type DesktopWorkflowRequest,
} from './desktop-workflow-contract.ts'
import { executeDesktopWorkflowOp } from './desktop-workflow-controller.ts'
import type { WorkflowOpenAiApiController } from './desktop-workflow-openai-controller.ts'
import { formatWorkflowError } from './desktop-workflow-errors.ts'

const MAX_BODY_BYTES = 512 * 1024

/** Exported for tests: every op name the route accepts. */
export const DESKTOP_WORKFLOW_OPS = new Set<DesktopWorkflowOp>([
  'listWorkflows',
  'getWorkflow',
  'saveWorkflow',
  'deleteWorkflow',
  'validateWorkflow',
  'listRuns',
  'getRun',
  'getTranscript',
  'startRun',
  'stopRun',
  'deleteRun',
  'exportRun',
  'purgeRuns',
  'listGates',
  'resolveGate',
  'listTemplates',
  'saveTemplate',
  'deleteTemplate',
  'promoteWorkflowToTemplate',
  'listBindings',
  'getBinding',
  'setBinding',
  'clearBinding',
  'startBoundRun',
  'getStats',
  'getWorkflowStats',
  'getWorkflowStatsDetail',
  'getSettings',
  'setSettings',
  'listModelCatalog',
  'registerCustomProvider',
  'canonicalizeYaml',
  'exportWorkflowYaml',
  'designWorkflow',
  'listTriggers',
  'addTrigger',
  'removeTrigger',
  'enableTrigger',
  'disableTrigger',
  'fireManualTrigger',
  'fireTriggerEvent',
  'getOpenAiApiStatus',
  'setOpenAiApiSettings',
  'rotateOpenAiApiKey',
  'listOpenAiApiCalls',
  'clearOpenAiApiCalls',
  'awfGetSettings',
  'awfSetSettings',
  'awfCheckConnection',
  'awfSync',
  'awfSyncPull',
  'awfRemoteRun',
  'awfSetTelemetrySettings',
  'awfGetExecutorStatus',
  'awfSetExecutorSettings',
  'awfGetTunnelStatus',
  'awfSetTunnelSettings',
  'awfAuthStatus',
  'awfAuthMethods',
  'awfAuthRegister',
  'awfAuthLogin',
  'awfAuthSendPhoneCode',
  'awfAuthPhoneLogin',
  'awfAuthLogout',
  // RSI: self-iterating improvement problems and their review iterations.
  'rsiListProblems',
  'rsiCreateProblem',
  'rsiRunIteration',
  'rsiGetIterations',
  'rsiDeleteProblem',
])

class BodyTooLargeError extends Error {}

function finishJson(
  res: ServerResponse,
  statusCode: number,
  value: object,
  allow?: 'POST',
): void {
  res.statusCode = statusCode
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  if (allow !== undefined) res.setHeader('allow', allow)
  res.end(JSON.stringify(value))
}

function error(message: string): DesktopWorkflowErrorResponse {
  return { error: message }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === '[::1]'
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false
  if (address === '::1' || address === '127.0.0.1') return true
  if (address.startsWith('::ffff:')) {
    const mapped = address.slice('::ffff:'.length)
    return mapped.startsWith('127.')
  }
  return address.startsWith('127.')
}

function expectedLoopbackOrigin(expectedOrigin: string): URL | undefined {
  try {
    const url = new URL(expectedOrigin)
    if (url.origin !== expectedOrigin || url.protocol !== 'http:'
      || url.username !== '' || url.password !== ''
      || !isLoopbackHostname(url.hostname)) return undefined
    return url
  } catch {
    return undefined
  }
}

function exactHeaderOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    return url.origin === value ? value : undefined
  } catch {
    return undefined
  }
}

function isSameOriginLoopbackRequest(req: IncomingMessage, expectedOrigin: string): boolean {
  const expected = expectedLoopbackOrigin(expectedOrigin)
  if (expected === undefined || !isLoopbackAddress(req.socket.remoteAddress)) return false
  if (req.headers.host?.toLowerCase() !== expected.host.toLowerCase()) return false
  if (exactHeaderOrigin(req.headers.origin) === expected.origin) {
    return req.headers['sec-fetch-site'] === undefined || req.headers['sec-fetch-site'] === 'same-origin'
  }
  return false
}

function isJsonRequest(req: IncomingMessage): boolean {
  return req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const declaredLength = req.headers['content-length']
  if (declaredLength !== undefined) {
    if (!/^\d+$/.test(declaredLength)) throw new SyntaxError('invalid content length')
    if (Number(declaredLength) > MAX_BODY_BYTES) throw new BodyTooLargeError()
  }
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) throw new BodyTooLargeError()
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/** Exported for tests: the request allowlist + field whitelist gate. */
export function parseRequest(value: unknown): DesktopWorkflowRequest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.op !== 'string' || !DESKTOP_WORKFLOW_OPS.has(record.op as DesktopWorkflowOp)) return undefined

  const request: DesktopWorkflowRequest = { op: record.op as DesktopWorkflowOp }
  const withFields: Record<string, unknown> = { ...request }
  const copyString = (key: string) => {
    const v = record[key]
    if (typeof v === 'string') withFields[key] = v
  }
  copyString('name')
  copyString('yaml')
  copyString('workflowName')
  copyString('runId')
  copyString('stepId')
  copyString('decision')
  copyString('resolvedBy')
  copyString('token')
  copyString('workspaceId')
  copyString('prompt')
  copyString('mode')
  copyString('designModel')
  copyString('triggerId')
  copyString('source')
  copyString('eventName')
  copyString('after')
  copyString('since')
  copyString('awfVisibility')
  copyString('templateName')
  copyString('templateDescription')
  copyString('templateCategory')
  copyString('templateId')
  if (typeof record.limit === 'number' && Number.isFinite(record.limit)) {
    withFields.limit = record.limit
  }
  if (typeof record.recentLimit === 'number' && Number.isFinite(record.recentLimit)) {
    withFields.recentLimit = record.recentLimit
  }
  if (typeof record.maxTokens === 'number' && Number.isFinite(record.maxTokens)) {
    withFields.maxTokens = record.maxTokens
  }
  if (typeof record.includeModelCatalog === 'boolean') {
    withFields.includeModelCatalog = record.includeModelCatalog
  }
  if (record.params && typeof record.params === 'object' && !Array.isArray(record.params)) {
    withFields.params = record.params
  }
  if (record.settings && typeof record.settings === 'object' && !Array.isArray(record.settings)) {
    withFields.settings = record.settings
  }
  if (record.customProvider && typeof record.customProvider === 'object' && !Array.isArray(record.customProvider)) {
    withFields.customProvider = record.customProvider
  }
  if (record.triggerConfig && typeof record.triggerConfig === 'object' && !Array.isArray(record.triggerConfig)) {
    withFields.triggerConfig = record.triggerConfig
  }
  if (record.data && typeof record.data === 'object' && !Array.isArray(record.data)) {
    withFields.data = record.data
  }
  if (record.openAiApiSettings && typeof record.openAiApiSettings === 'object' && !Array.isArray(record.openAiApiSettings)) {
    withFields.openAiApiSettings = record.openAiApiSettings
  }
  if (record.awfSettings && typeof record.awfSettings === 'object' && !Array.isArray(record.awfSettings)) {
    const raw = record.awfSettings as Record<string, unknown>
    withFields.awfSettings = {
      ...(typeof raw.baseUrl === 'string' ? { baseUrl: raw.baseUrl } : {}),
      ...(typeof raw.apiTokenEnv === 'string' ? { apiTokenEnv: raw.apiTokenEnv } : {}),
      ...(typeof raw.apiToken === 'string' ? { apiToken: raw.apiToken } : {}),
    }
  }
  if (record.awfTelemetrySettings && typeof record.awfTelemetrySettings === 'object' && !Array.isArray(record.awfTelemetrySettings)) {
    const raw = record.awfTelemetrySettings as Record<string, unknown>
    withFields.awfTelemetrySettings = {
      ...(typeof raw.telemetryEnabled === 'boolean' ? { telemetryEnabled: raw.telemetryEnabled } : {}),
    }
  }
  if (record.awfExecutorSettings && typeof record.awfExecutorSettings === 'object' && !Array.isArray(record.awfExecutorSettings)) {
    const raw = record.awfExecutorSettings as Record<string, unknown>
    withFields.awfExecutorSettings = {
      ...(typeof raw.executorEnabled === 'boolean' ? { executorEnabled: raw.executorEnabled } : {}),
    }
  }
  if (record.awfTunnelSettings && typeof record.awfTunnelSettings === 'object' && !Array.isArray(record.awfTunnelSettings)) {
    const raw = record.awfTunnelSettings as Record<string, unknown>
    withFields.awfTunnelSettings = {
      ...(typeof raw.tunnelEnabled === 'boolean' ? { tunnelEnabled: raw.tunnelEnabled } : {}),
      ...(typeof raw.localPort === 'number' && Number.isFinite(raw.localPort) ? { localPort: raw.localPort } : {}),
    }
  }
  // awfAuth* credentials: whitelisted keys only — the password exists in this
  // request body alone and must never be persisted or echoed back.
  if (record.awfAuthCredentials && typeof record.awfAuthCredentials === 'object' && !Array.isArray(record.awfAuthCredentials)) {
    const raw = record.awfAuthCredentials as Record<string, unknown>
    withFields.awfAuthCredentials = {
      ...(typeof raw.email === 'string' ? { email: raw.email } : {}),
      ...(typeof raw.password === 'string' ? { password: raw.password } : {}),
      ...(typeof raw.displayName === 'string' ? { displayName: raw.displayName } : {}),
      ...(typeof raw.phone === 'string' ? { phone: raw.phone } : {}),
      ...(typeof raw.code === 'string' ? { code: raw.code } : {}),
    }
  }
  if (typeof record.awfPublish === 'boolean') {
    withFields.awfPublish = record.awfPublish
  }
  if (typeof record.awfWorkflowId === 'number' && Number.isFinite(record.awfWorkflowId)) {
    withFields.awfWorkflowId = record.awfWorkflowId
  }
  if (record.rsiConfig && typeof record.rsiConfig === 'object' && !Array.isArray(record.rsiConfig)) {
    const raw = record.rsiConfig as Record<string, unknown>
    withFields.rsiConfig = {
      ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
      ...(typeof raw.domain === 'string' ? { domain: raw.domain } : {}),
      ...(typeof raw.maxIterations === 'number' && Number.isFinite(raw.maxIterations)
        ? { maxIterations: raw.maxIterations } : {}),
      ...(typeof raw.reviewProviderId === 'number' && Number.isFinite(raw.reviewProviderId)
        ? { reviewProviderId: raw.reviewProviderId } : {}),
      ...(typeof raw.improvementCriteria === 'string' ? { improvementCriteria: raw.improvementCriteria } : {}),
      ...(typeof raw.baseYaml === 'string' ? { baseYaml: raw.baseYaml } : {}),
    }
  }
  if (typeof record.rsiProblemId === 'number' && Number.isFinite(record.rsiProblemId)) {
    withFields.rsiProblemId = record.rsiProblemId
  }
  return withFields as unknown as DesktopWorkflowRequest
}

/**
 * Handle POST /api/desktop/workflow.
 * @param req - Incoming HTTP request.
 * @param res - HTTP response.
 * @param expectedOrigin - Loopback renderer origin.
 * @param plugin - Initialized workflow plugin.
 * @param reportError - Host logger for unexpected failures.
 * @param hostCtx - Optional Cordis context for LLM catalog / custom provider writes.
 */
export async function handleDesktopWorkflowRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  plugin: WorkflowPlugin,
  reportError: (operation: string, cause: unknown) => void,
  hostCtx?: import('@deepseek-ai/cordis').Context,
  openAiApi?: WorkflowOpenAiApiController,
  awfBridge?: import('./desktop-awf-bridge.ts').AwfBridge,
  awfExecutor?: import('./desktop-awf-executor.ts').AwfExecutorController,
): Promise<void> {
  if (req.method !== 'POST') {
    finishJson(res, 405, error('method not allowed'), 'POST')
    return
  }
  if (!isSameOriginLoopbackRequest(req, expectedOrigin)) {
    finishJson(res, 403, error('forbidden'))
    return
  }
  if (!isJsonRequest(req)) {
    finishJson(res, 415, error('content-type must be application/json'))
    return
  }

  let body: unknown
  try {
    body = await readJson(req)
  } catch (cause) {
    if (cause instanceof BodyTooLargeError) {
      finishJson(res, 413, error('request body too large'))
      return
    }
    finishJson(res, 400, error('invalid json'))
    return
  }

  const request = parseRequest(body)
  if (request === undefined) {
    finishJson(res, 400, error('invalid workflow request'))
    return
  }

  try {
    const result = await executeDesktopWorkflowOp(
      plugin,
      request,
      hostCtx,
      {
        ...(openAiApi ? { openAiApi } : {}),
        ...(awfBridge ? { awf: awfBridge, awfBridge } : {}),
        ...(awfExecutor ? { awfExecutor } : {}),
      },
    )
    finishJson(res, 200, { ok: true, result })
  } catch (cause) {
    reportError(`workflow ${request.op}`, cause)
    finishJson(res, 400, error(formatWorkflowError(cause)))
  }
}

export { DESKTOP_WORKFLOW_PATH }
