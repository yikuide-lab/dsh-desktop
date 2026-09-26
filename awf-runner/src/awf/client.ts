/**
 * Minimal REST client for the AWF platform (workflow-wise twin of this plugin).
 *
 * Canonical pure-Node home of the AWF client (shared by the desktop plugins
 * and the headless awf-node runner). Error surfaces are classified for UI
 * handling: network / auth / validation / conflict / not-found / server.
 * Token comes from settings resolution (see ./settings.js) and is only ever
 * sent as a Bearer header — never logged, never embedded in URLs or payloads.
 */

import type { AwfSettings } from './settings.js'
import { resolveAwfToken } from './settings.js'

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
  /** Platform may return string messages or structured {path,code,msg}. */
  readonly errors: ReadonlyArray<string | { path: string; code: string; msg: string }>
  readonly warnings?: readonly string[]
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

export interface AwfRunGate {
  readonly step_id?: string
  readonly token: string
  readonly resolved?: boolean
  readonly question?: string
  readonly options?: readonly string[]
}

export interface AwfRun {
  readonly id: number
  /** Runner UUID; CreateRun also returns as run_id. Prefer for poll + resolveGate. */
  readonly runner_run_id: string
  /** Alias of runner_run_id when present on CreateRun / GetRun responses. */
  readonly run_id?: string
  readonly status: string
  readonly result_text?: string
  readonly error_text?: string
  readonly auto_approve?: boolean
  readonly external_loop_id?: string | null
  readonly external_branch_id?: string | null
  readonly gates?: readonly AwfRunGate[]
}

export type AwfFetch = typeof fetch

export interface AwfCreateRunOptions {
  readonly autoApprove?: boolean
  readonly externalLoopId?: string
  readonly externalBranchId?: string
}

export interface AwfClient {
  checkConnection(): Promise<{ ok: boolean; email: string | null }>
  capabilities(): Promise<AwfCapabilities>
  syncValidate(items: readonly AwfSyncItem[]): Promise<readonly AwfValidateResult[]>
  syncPush(items: readonly AwfSyncItem[]): Promise<readonly AwfWorkflowSummary[]>
  syncPull(): Promise<readonly AwfWorkflowSummary[]>
  createRun(workflowId: number, params: Record<string, string>, options?: AwfCreateRunOptions): Promise<AwfRun>
  listRuns(workflowId: number): Promise<readonly AwfRun[]>
  /** GET single run by runner UUID or run_records numeric id (AWF A1). */
  getRun(runId: string | number): Promise<AwfRun>
  /** Path run id: runner UUID preferred; numeric id still accepted for legacy. */
  resolveGate(runId: string | number, token: string, decision: string): Promise<AwfRun>
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
  readonly external_loop_id?: string
  readonly external_branch_id?: string
}

/** Normalize CreateRun/GetRun shapes: platform may return run_id without runner_run_id. */
function normalizeAwfRun(run: AwfRun): AwfRun {
  const runner = run.runner_run_id || run.run_id || ''
  if (!runner) return run
  return {
    ...run,
    runner_run_id: runner,
    run_id: run.run_id || runner,
  }
}

export function createAwfClient(
  settings: AwfSettings,
  options: {
    fetchImpl?: AwfFetch
    env?: Record<string, string | undefined>
    token?: string
    /** 每次请求前动态解析 Bearer（登录会话 access token）；优先于静态 token。 */
    tokenProvider?: () => Promise<string | null>
    /** 401 时的补救路径（如刷新会话）；返回新 token 则重试一次，返回 null 则照常抛错。 */
    onAuthFailure?: () => Promise<string | null>
  } = {},
): AwfClient {
  const doFetch = options.fetchImpl ?? fetch
  const token = options.token ?? resolveAwfToken(settings, options.env)
  const base = settings.baseUrl.replace(/\/+$/, '')

  async function resolveBearer(): Promise<string | null> {
    if (options.tokenProvider) {
      const provided = await options.tokenProvider()
      if (provided) return provided
    }
    return token || null
  }

  async function request<T>(
    path: string,
    init: RequestInit = {},
    authenticated = true,
    allowAuthRetry = true,
    overrideToken: string | null = null,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    }
    if (authenticated) {
      const bearer = overrideToken ?? (await resolveBearer())
      if (bearer) headers.Authorization = `Bearer ${bearer}`
    }
    let response: Response
    try {
      response = await doFetch(`${base}${path}`, { ...init, headers })
    } catch (error) {
      throw new AwfError('network', `无法连接 AWF 平台（${base}）`, null, error)
    }
    // 会话 access token 过期 → onAuthFailure（刷新）拿到新 token 后带新凭据重试一次
    if (response.status === 401 && authenticated && allowAuthRetry && options.onAuthFailure) {
      const fresh = await options.onAuthFailure()
      if (fresh) {
        return request<T>(path, init, authenticated, false, fresh)
      }
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
      const body: Record<string, unknown> = {
        params,
        auto_approve: options.autoApprove ?? false,
      }
      if (options.externalLoopId) body.external_loop_id = options.externalLoopId
      if (options.externalBranchId) body.external_branch_id = options.externalBranchId
      return request<AwfRun>(`/api/workflows/${workflowId}/runs`, {
        method: 'POST',
        body: JSON.stringify(body),
      }).then(normalizeAwfRun)
    },
    listRuns(workflowId) {
      return request<readonly AwfRun[]>(`/api/workflows/${workflowId}/runs`).then((rows) =>
        rows.map(normalizeAwfRun),
      )
    },
    getRun(runId) {
      return request<AwfRun>(`/api/workflows/runs/${encodeURIComponent(String(runId))}`).then(normalizeAwfRun)
    },
    resolveGate(runId, gateToken, decision) {
      // 路径段编码：防 token 中保留字符（/ ? # 等）改变路径语义；runId 可为 runner UUID
      return request<AwfRun>(`/api/workflows/runs/${encodeURIComponent(String(runId))}/gates/${encodeURIComponent(gateToken)}`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      }).then(normalizeAwfRun)
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
