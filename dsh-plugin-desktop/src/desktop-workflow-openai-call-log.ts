/**
 * Ring-buffer persistence for Workflow OpenAI-compatible API call records.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const WORKFLOW_OPENAI_API_CALL_LOG_MAX = 100

export interface WorkflowOpenAiApiCallRecord {
  readonly id: string
  /** ISO timestamp when the request was accepted. */
  readonly ts: string
  readonly method: string
  readonly path: string
  readonly clientIp: string
  readonly model?: string
  readonly workflowName?: string
  readonly runId?: string
  readonly statusCode: number
  readonly ok: boolean
  readonly error?: string
  readonly durationMs?: number
  readonly stream?: boolean
}

export interface WorkflowOpenAiApiCallLogAppendInput {
  readonly method: string
  readonly path: string
  readonly clientIp: string
  readonly statusCode: number
  readonly ok: boolean
  readonly model?: string
  readonly workflowName?: string
  readonly runId?: string
  readonly error?: string
  readonly durationMs?: number
  readonly stream?: boolean
  readonly ts?: string
}

function callLogPath(stateDir: string): string {
  return join(stateDir, 'openai-api-calls.json')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeRecord(value: unknown): WorkflowOpenAiApiCallRecord | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.ts !== 'string') return null
  if (typeof value.method !== 'string' || typeof value.path !== 'string') return null
  if (typeof value.clientIp !== 'string' || typeof value.statusCode !== 'number') return null
  return {
    id: value.id,
    ts: value.ts,
    method: value.method,
    path: value.path,
    clientIp: value.clientIp,
    statusCode: value.statusCode,
    ok: value.ok === true,
    ...(typeof value.model === 'string' ? { model: value.model } : {}),
    ...(typeof value.workflowName === 'string' ? { workflowName: value.workflowName } : {}),
    ...(typeof value.runId === 'string' ? { runId: value.runId } : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
    ...(typeof value.durationMs === 'number' ? { durationMs: value.durationMs } : {}),
    ...(typeof value.stream === 'boolean' ? { stream: value.stream } : {}),
  }
}

/** Load persisted API call records (newest first). */
export async function readWorkflowOpenAiApiCallLog(
  stateDir: string,
  limit = WORKFLOW_OPENAI_API_CALL_LOG_MAX,
): Promise<WorkflowOpenAiApiCallRecord[]> {
  try {
    const raw = JSON.parse(await readFile(callLogPath(stateDir), 'utf8')) as unknown
    const list = Array.isArray(raw)
      ? raw
      : (isRecord(raw) && Array.isArray(raw.calls) ? raw.calls : [])
    return list
      .map(normalizeRecord)
      .filter((entry): entry is WorkflowOpenAiApiCallRecord => entry !== null)
      .slice(0, Math.max(0, limit))
  } catch {
    return []
  }
}

/** Append one call record and trim to the retention window. */
export async function appendWorkflowOpenAiApiCall(
  stateDir: string,
  input: WorkflowOpenAiApiCallLogAppendInput,
): Promise<WorkflowOpenAiApiCallRecord> {
  const record: WorkflowOpenAiApiCallRecord = {
    id: randomUUID(),
    ts: input.ts ?? new Date().toISOString(),
    method: input.method,
    path: input.path,
    clientIp: input.clientIp,
    statusCode: input.statusCode,
    ok: input.ok,
    ...(input.model ? { model: input.model } : {}),
    ...(input.workflowName ? { workflowName: input.workflowName } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.error ? { error: input.error } : {}),
    ...(typeof input.durationMs === 'number' ? { durationMs: input.durationMs } : {}),
    ...(typeof input.stream === 'boolean' ? { stream: input.stream } : {}),
  }
  const existing = await readWorkflowOpenAiApiCallLog(stateDir, WORKFLOW_OPENAI_API_CALL_LOG_MAX)
  const next = [record, ...existing].slice(0, WORKFLOW_OPENAI_API_CALL_LOG_MAX)
  const path = callLogPath(stateDir)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify({ calls: next }, null, 2)}\n`, 'utf8')
  return record
}

/** Clear all persisted API call records. */
export async function clearWorkflowOpenAiApiCallLog(stateDir: string): Promise<void> {
  const path = callLogPath(stateDir)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify({ calls: [] }, null, 2)}\n`, 'utf8')
}
