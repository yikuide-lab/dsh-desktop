/**
 * Persisted settings for the optional Workflow OpenAI-compatible API server.
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const WORKFLOW_OPENAI_API_DEFAULT_PORT = 8787
export const WORKFLOW_OPENAI_API_DEFAULT_HOST = '0.0.0.0'
export const WORKFLOW_OPENAI_API_MAX_BODY_BYTES = 512 * 1024
export const WORKFLOW_OPENAI_API_MAX_CONCURRENT = 4

export interface WorkflowOpenAiApiSettings {
  readonly enabled: boolean
  readonly bindHost: string
  readonly port: number
  /** Bearer token; empty when disabled and never generated. */
  readonly apiKey: string
  readonly maxBodyBytes: number
  readonly maxConcurrent: number
}

export interface WorkflowOpenAiApiPublicSettings {
  readonly enabled: boolean
  readonly bindHost: string
  readonly port: number
  /** Whether a key is configured (never return the raw key in status). */
  readonly hasApiKey: boolean
  readonly maxBodyBytes: number
  readonly maxConcurrent: number
  readonly listening: boolean
  readonly baseUrl: string | null
  readonly usingTls: boolean
  readonly lastError: string | null
}

export function defaultWorkflowOpenAiApiSettings(): WorkflowOpenAiApiSettings {
  return {
    enabled: false,
    bindHost: WORKFLOW_OPENAI_API_DEFAULT_HOST,
    port: WORKFLOW_OPENAI_API_DEFAULT_PORT,
    apiKey: '',
    maxBodyBytes: WORKFLOW_OPENAI_API_MAX_BODY_BYTES,
    maxConcurrent: WORKFLOW_OPENAI_API_MAX_CONCURRENT,
  }
}

export function workflowOpenAiApiSettingsPath(stateDir: string): string {
  return join(stateDir, 'openai-api.json')
}

/** Generate a URL-safe high-entropy API key. */
export function generateWorkflowOpenAiApiKey(): string {
  return `dsh_wf_${randomBytes(24).toString('base64url')}`
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === 'localhost'
}

export function normalizeWorkflowOpenAiApiSettings(
  raw: Partial<WorkflowOpenAiApiSettings> | undefined,
): WorkflowOpenAiApiSettings {
  const defaults = defaultWorkflowOpenAiApiSettings()
  if (!raw || typeof raw !== 'object') return defaults
  const port = typeof raw.port === 'number' && Number.isInteger(raw.port) && raw.port > 0 && raw.port <= 65535
    ? raw.port
    : defaults.port
  const bindHost = typeof raw.bindHost === 'string' && raw.bindHost.trim()
    ? raw.bindHost.trim()
    : defaults.bindHost
  const maxBodyBytes = typeof raw.maxBodyBytes === 'number'
    && Number.isInteger(raw.maxBodyBytes)
    && raw.maxBodyBytes > 0
    ? Math.min(raw.maxBodyBytes, 8 * 1024 * 1024)
    : defaults.maxBodyBytes
  const maxConcurrent = typeof raw.maxConcurrent === 'number'
    && Number.isInteger(raw.maxConcurrent)
    && raw.maxConcurrent > 0
    ? Math.min(raw.maxConcurrent, 32)
    : defaults.maxConcurrent
  return {
    enabled: Boolean(raw.enabled),
    bindHost,
    port,
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
    maxBodyBytes,
    maxConcurrent,
  }
}

export async function readWorkflowOpenAiApiSettings(
  stateDir: string,
): Promise<WorkflowOpenAiApiSettings> {
  try {
    const raw = await readFile(workflowOpenAiApiSettingsPath(stateDir), 'utf8')
    return normalizeWorkflowOpenAiApiSettings(JSON.parse(raw) as Partial<WorkflowOpenAiApiSettings>)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultWorkflowOpenAiApiSettings()
    }
    throw error
  }
}

export async function writeWorkflowOpenAiApiSettings(
  stateDir: string,
  settings: WorkflowOpenAiApiSettings,
): Promise<WorkflowOpenAiApiSettings> {
  const normalized = normalizeWorkflowOpenAiApiSettings(settings)
  const path = workflowOpenAiApiSettingsPath(stateDir)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  return normalized
}

export function toPublicWorkflowOpenAiApiSettings(
  settings: WorkflowOpenAiApiSettings,
  runtime: {
    listening: boolean
    baseUrl: string | null
    usingTls: boolean
    lastError: string | null
  },
): WorkflowOpenAiApiPublicSettings {
  return {
    enabled: settings.enabled,
    bindHost: settings.bindHost,
    port: settings.port,
    hasApiKey: settings.apiKey.length > 0,
    maxBodyBytes: settings.maxBodyBytes,
    maxConcurrent: settings.maxConcurrent,
    listening: runtime.listening,
    baseUrl: runtime.baseUrl,
    usingTls: runtime.usingTls,
    lastError: runtime.lastError,
  }
}
