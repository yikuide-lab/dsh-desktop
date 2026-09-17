/**
 * Minimal REST client for the AWF platform (workflow-wise twin of this plugin).
 *
 * Error surfaces are classified for UI handling: network / auth / validation /
 * conflict / not-found / server. Token comes from settings resolution
 * (see desktop-awf-settings.ts) and is only ever sent as a Bearer header —
 * never logged, never embedded in URLs or payloads.
 */

import type { AwfSettings } from './desktop-awf-settings.ts'
import { resolveAwfToken } from './desktop-awf-settings.ts'

export type AwfErrorKind = 'network' | 'auth' | 'validation' | 'conflict' | 'not-found' | 'server'

export class AwfError extends Error {
  readonly kind: AwfErrorKind
  readonly status: number | null
  readonly detail: unknown

  constructor(kind: AwfErrorKind, message: string, status: number | null = null, detail: unknown = undefined) {
    super(message)
    this.name = 'AwfError'
    this.kind = kind
    this.status = status
    this.detail = detail
  }
}

export interface AwfSyncItem {
  readonly name: string
  readonly yaml_text: string
  readonly title?: string
  readonly description?: string
  readonly version?: string
  readonly visibility?: 'private' | 'unlisted' | 'public'
}

export interface AwfValidateResult {
  readonly name: string
  readonly ok: boolean
  readonly errors: Array<{ path: string; code: string; msg: string }>
  readonly conflict: string | null
}

export interface AwfWorkflowSummary {
  readonly id: number
  readonly name: string
  readonly title: string
  readonly status: string
  readonly visibility: string
  readonly updated_at?: string
}

export interface AwfCapabilities {
  readonly dsl_version: string
  readonly base_step_types: string[]
  readonly platform_extension_types: string[]
  readonly features: { gate: boolean; sub_workflow: boolean; compensation: boolean }
}

export interface AwfRun {
  readonly id: number
  readonly runner_run_id: string
  readonly status: string
  readonly result_text?: string
  readonly error_text?: string
  readonly gates?: Array<{ step_id: string; token: string; resolved: boolean }>
}

export type AwfFetch = typeof fetch

export interface AwfClient {
  checkConnection(): Promise<{ ok: boolean; email: string | null }>
  capabilities(): Promise<AwfCapabilities>
  syncValidate(items: readonly AwfSyncItem[]): Promise<readonly AwfValidateResult[]>
  syncPush(items: readonly AwfSyncItem[]): Promise<readonly AwfWorkflowSummary[]>
  syncPull(): Promise<readonly AwfWorkflowSummary[]>
  createRun(workflowId: number, params: Record<string, string>, options?: { autoApprove?: boolean }): Promise<AwfRun>
  listRuns(workflowId: number): Promise<readonly AwfRun[]>
  resolveGate(runDbId: number, token: string, decision: string): Promise<AwfRun>
  publish(workflowId: number, note?: string): Promise<AwfWorkflowSummary>
  /** 摘要级遥测上报（C-P4）：只含名称/状态/步骤状态/token 估算/耗时。 */
  telemetryRun(summary: AwfTelemetrySummary): Promise<{ ok: boolean; id: number }>
}

/** 摘要级遥测载荷；契约上禁止 prompt / 输出内容字段。 */
export interface AwfTelemetrySummary {
  readonly client: 'desktop'
  readonly workflow_name: string
  readonly run_ref: string
  readonly status: string
  readonly steps: ReadonlyArray<{ id: string; type: string; status: string }>
  readonly token_estimate?: number
  readonly duration_ms?: number
  readonly finished_at?: string
}

export function createAwfClient(
  settings: AwfSettings,
  options: { fetchImpl?: AwfFetch; env?: Record<string, string | undefined>; token?: string } = {},
): AwfClient {
  const doFetch = options.fetchImpl ?? fetch
  const token = options.token ?? resolveAwfToken(settings, options.env)
  const base = settings.baseUrl.replace(/\/+$/, '')

  async function request<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    }
    if (authenticated && token) headers.Authorization = `Bearer ${token}`
    let response: Response
    try {
      response = await doFetch(`${base}${path}`, { ...init, headers })
    } catch (error) {
      throw new AwfError('network', `无法连接 AWF 平台（${base}）`, null, error)
    }
    if (response.ok) {
      const text = await response.text()
      return (text ? JSON.parse(text) : null) as T
    }
    let detail: unknown = null
    try {
      detail = await response.json()
    } catch {
      detail = null
    }
    const messageFromDetail = (d: unknown): string => {
      if (d && typeof d === 'object' && 'detail' in d) {
        const inner = (d as { detail: unknown }).detail
        if (typeof inner === 'string') return inner
        if (inner && typeof inner === 'object' && 'message' in inner) {
          return String((inner as { message: unknown }).message)
        }
        return JSON.stringify(inner)
      }
      return `HTTP ${response.status}`
    }
    const message = messageFromDetail(detail)
    switch (response.status) {
      case 401:
      case 403:
        throw new AwfError('auth', `AWF 鉴权失败：${message}`, response.status, detail)
      case 400:
      case 422:
        throw new AwfError('validation', message, response.status, detail)
      case 404:
        throw new AwfError('not-found', message, response.status, detail)
      case 409:
        throw new AwfError('conflict', message, response.status, detail)
      default:
        throw new AwfError('server', message, response.status, detail)
    }
  }

  return {
    async checkConnection() {
      await request<{ ok: boolean }>('/health', {}, false)
      const me = await request<{ email?: string } | null>('/api/auth/me').catch((error: AwfError) => {
        if (error.kind === 'not-found') return null
        throw error
      })
      return { ok: true, email: me?.email ?? null }
    },
    capabilities() {
      return request<AwfCapabilities>('/api/dsl/capabilities', {}, false)
    },
    syncValidate(items) {
      return request<readonly AwfValidateResult[]>('/api/sync/validate', {
        method: 'POST',
        body: JSON.stringify({ workflows: items }),
      })
    },
    syncPush(items) {
      return request<readonly AwfWorkflowSummary[]>('/api/sync/workflows', {
        method: 'POST',
        body: JSON.stringify({ workflows: items }),
      })
    },
    syncPull() {
      return request<readonly AwfWorkflowSummary[]>('/api/sync/workflows')
    },
    createRun(workflowId, params, options = {}) {
      // 默认 auto_approve=false：与本地引擎对齐（审批门等待人工 resolve），双跑语义一致
      return request<AwfRun>(`/api/workflows/${workflowId}/runs`, {
        method: 'POST',
        body: JSON.stringify({ params, auto_approve: options.autoApprove ?? false }),
      })
    },
    listRuns(workflowId) {
      return request<readonly AwfRun[]>(`/api/workflows/${workflowId}/runs`)
    },
    resolveGate(runDbId, gateToken, decision) {
      // 路径段编码：防 token 中保留字符（/ ? # 等）改变路径语义
      return request<AwfRun>(`/api/workflows/runs/${encodeURIComponent(String(runDbId))}/gates/${encodeURIComponent(gateToken)}`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      })
    },
    publish(workflowId, note = 'dsh sync') {
      return request<AwfWorkflowSummary>(`/api/workflows/${workflowId}/publish`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      })
    },
    telemetryRun(summary) {
      return request<{ ok: boolean; id: number }>('/api/telemetry/runs', {
        method: 'POST',
        body: JSON.stringify(summary),
      })
    },
  }
}
