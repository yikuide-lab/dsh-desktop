/**
 * Host-side AWF connector bridge: settings + connection check + sync-to-AWF action.
 *
 * Wraps desktop-awf-client for the Desktop workflow op layer. Credentials follow
 * the settings module rules (env var first, 0600 saved file, fingerprint-only
 * status). Sync always preflights (POST /api/sync/validate) before pushing.
 */

import type { WorkflowPlugin } from 'dsh-plugin-workflow'
import { AwfError, createAwfClient, type AwfFetch, type AwfSyncItem, type AwfWorkflowSummary } from './desktop-awf-client.ts'
import {
  readAwfSettings,
  resolveAwfToken,
  toPublicAwfSettings,
  writeAwfSettings,
  type AwfSettings,
} from './desktop-awf-settings.ts'
import {
  awfAuthAccessToken,
  awfAuthLogin,
  awfAuthLogout,
  awfAuthMethods,
  awfAuthPhoneLogin,
  awfAuthRefresh,
  awfAuthRegister,
  awfAuthSendPhoneCode,
  awfAuthStatus,
  type AwfAuthMethods,
  type AwfAuthStatusView,
} from './desktop-awf-auth.ts'
import { createTunnelClient, type TunnelClientHandle } from 'awf-runner'
import { assertAwfSyncAllowed } from './desktop-awf-collab-guard.ts'

export interface AwfBridgeOptions {
  readonly plugin: WorkflowPlugin
  readonly stateDir: string
  readonly log?: (message: string) => void
  /** Test seam: inject fetch / env without touching globals. */
  readonly fetchImpl?: AwfFetch
  readonly env?: Record<string, string | undefined>
}

export interface AwfPublicStatus {
  readonly baseUrl: string
  readonly apiTokenEnv: string
  readonly hasToken: boolean
  readonly tokenFingerprint: string
  readonly telemetryEnabled: boolean
  readonly executorEnabled: boolean
  readonly tunnelEnabled: boolean
}

export interface AwfPreflightEntry {
  readonly name: string
  readonly ok: boolean
  readonly errors: ReadonlyArray<{ path: string; code: string; msg: string } | string>
  readonly conflict: string | null
  readonly warnings?: readonly string[]
}

export interface AwfSyncReceipt {
  readonly ok: boolean
  readonly stage: 'preflight' | 'pushed' | 'error'
  readonly validation?: AwfPreflightEntry
  readonly workflow?: { id: number; name: string; title: string; status: string; visibility: string }
  /** publish=true 时表示发布冻结成功。 */
  readonly published?: boolean
  readonly errorKind?: string
  readonly errorMessage?: string
}

export interface AwfConnectionResult {
  readonly ok: boolean
  readonly email?: string
  readonly errorKind?: string
  readonly errorMessage?: string
}

export interface AwfRemoteRunResult {
  readonly ok: boolean
  readonly status?: string
  readonly resultText?: string
  readonly errorText?: string
  /** Platform run_records numeric id (legacy; prefer runnerRunId for gate resolve). */
  readonly runId?: number
  /** Runner UUID from createRun; canonical handle for poll + resolveGate. */
  readonly runnerRunId?: string
  readonly gates?: ReadonlyArray<{ token: string; step_id?: string; resolved?: boolean }>
  readonly errorKind?: string
  readonly errorMessage?: string
}

const AWF_REMOTE_RUN_TERMINAL = new Set(['finished', 'failed', 'waiting_gate', 'completed'])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

function runnerIdOf(run: { runner_run_id?: string; run_id?: string; id?: number }): string {
  return run.runner_run_id || run.run_id || (run.id !== undefined ? String(run.id) : '')
}

function toRemoteRunResult(run: {
  id: number
  runner_run_id?: string
  run_id?: string
  status: string
  result_text?: string
  error_text?: string
  gates?: ReadonlyArray<{ token: string; step_id?: string; resolved?: boolean }>
}): AwfRemoteRunResult {
  const runnerRunId = runnerIdOf(run)
  return {
    ok: true,
    status: run.status,
    runId: run.id,
    ...(run.result_text !== undefined ? { resultText: run.result_text } : {}),
    ...(run.error_text !== undefined ? { errorText: run.error_text } : {}),
    ...(runnerRunId ? { runnerRunId } : {}),
    ...(run.gates !== undefined ? { gates: run.gates } : {}),
  }
}

export type AwfRemoteRunInput = {
  workflowId: number
  params?: Record<string, string>
  externalLoopId?: string
  externalBranchId?: string
}

export interface AwfBridge {
  getSettings(): Promise<AwfPublicStatus>
  setSettings(input: {
    baseUrl?: string
    apiTokenEnv?: string
    apiToken?: string
    telemetryEnabled?: boolean
    executorEnabled?: boolean
    tunnelEnabled?: boolean
    tunnelLocalPort?: number
  }): Promise<AwfPublicStatus>
  checkConnection(): Promise<AwfConnectionResult>
  syncWorkflow(input: { name: string; yaml?: string; visibility?: string; publish?: boolean }): Promise<AwfSyncReceipt>
  /** 列出登录账号的平台工作流摘要（public + private），供会话座位聚合与刷新。 */
  pullWorkflows(): Promise<readonly AwfWorkflowSummary[]>
  /** 平台账号：可选注册/登录（邮箱、手机验证码）；密码绝不落盘。 */
  authStatus(): Promise<AwfAuthStatusView>
  authMethods(): Promise<AwfAuthMethods>
  authRegister(input: { email: string; password: string; displayName?: string }): Promise<AwfAuthStatusView>
  authLogin(input: { email: string; password: string }): Promise<AwfAuthStatusView>
  authSendPhoneCode(phone: string): Promise<{ ok: boolean }>
  authPhoneLogin(input: { phone: string; code: string }): Promise<AwfAuthStatusView>
  authLogout(): Promise<{ ok: boolean }>
  /** 远程试运行：对平台工作流发起一次执行（auto_approve=false，轮询由调用方负责）。 */
  remoteRun(input: AwfRemoteRunInput): Promise<AwfRemoteRunResult>
  /** 远程试运行并轮询至 finished | failed | waiting_gate | completed 或超时。 */
  remoteRunAndWait(
    input: AwfRemoteRunInput,
    options?: { timeoutMs?: number; pollIntervalMs?: number },
  ): Promise<AwfRemoteRunResult>
  /** JWT 属主 resolve 平台 approval gate（run id = runner UUID）。 */
  resolveAwfGate(input: {
    runnerRunId: string
    token: string
    decision: string
  }): Promise<AwfRemoteRunResult>
  /** 按 runner UUID 轮询至终态 / waiting_gate / 超时。 */
  pollAwfRun(
    runnerRunId: string,
    options?: { timeoutMs?: number; pollIntervalMs?: number },
  ): Promise<AwfRemoteRunResult>
  /** 反向隧道：节点外拨 WS 连接 + 本地 OpenAI 兼容 HTTP 出口。 */
  getTunnelStatus(): Promise<{
    connected: boolean
    localPort: number
    executorId: number | null
    since: string | null
    error: string | null
  }>
  setTunnelSettings(tunnelEnabled: boolean, localPort: number): Promise<AwfPublicStatus>
}

/** 失败视图：状态 view 携带错误信息（与 AwfConnectionResult 字段对齐）。 */
function authErrorView(error: AwfError): { errorKind: string; errorMessage: string } {
  return { errorKind: error.kind, errorMessage: error.message }
}

export function createAwfBridge(options: AwfBridgeOptions): AwfBridge {
  const { plugin, stateDir } = options
  const log = options.log ?? ((): void => {})
  const fetchImpl = options.fetchImpl
  const env = options.env

  // Tunnel client state
  let tunnelClient: TunnelClientHandle | null = null
  let tunnelEnabled = false
  let tunnelLocalPort = 8787

  async function currentSettings(): Promise<AwfSettings> {
    return readAwfSettings(stateDir)
  }

  function authOptions() {
    return {
      stateDir,
      ...(fetchImpl ? { fetchImpl } : {}),
      ...(env ? { env } : {}),
    }
  }

  function clientFor(settings: AwfSettings) {
    return createAwfClient(settings, {
      ...(fetchImpl ? { fetchImpl } : {}),
      ...(env ? { env } : {}),
      // env / 手动 token 缺席时回退登录会话（自动刷新 access token）
      tokenProvider: async () => {
        if (resolveAwfToken(settings, env ?? process.env)) return null
        return awfAuthAccessToken(authOptions())
      },
      onAuthFailure: async () => {
        // env / 手动 token 无法刷新；会话 token 可走 refresh 旋转重试一次
        if (resolveAwfToken(settings, env ?? process.env)) return null
        return awfAuthRefresh(authOptions())
      },
    })
  }

  return {
    async authStatus(): Promise<AwfAuthStatusView> {
      return awfAuthStatus(authOptions())
    },

    async authMethods(): Promise<AwfAuthMethods> {
      return awfAuthMethods(authOptions())
    },

    async authRegister(input): Promise<AwfAuthStatusView> {
      try {
        const status = await awfAuthRegister(authOptions(), input)
        log(`AWF auth: registered ${status.email ?? ''}`)
        return status
      } catch (error) {
        if (error instanceof AwfError) {
          return { hasSession: false, ...(authErrorView(error)) }
        }
        return { hasSession: false, errorKind: 'network', errorMessage: String(error) }
      }
    },

    async authLogin(input): Promise<AwfAuthStatusView> {
      try {
        const status = await awfAuthLogin(authOptions(), input)
        log(`AWF auth: logged in ${status.email ?? ''}`)
        return status
      } catch (error) {
        if (error instanceof AwfError) {
          return { hasSession: false, ...(authErrorView(error)) }
        }
        return { hasSession: false, errorKind: 'network', errorMessage: String(error) }
      }
    },

    async authSendPhoneCode(phone) {
      try {
        await awfAuthSendPhoneCode(authOptions(), phone)
        return { ok: true }
      } catch (error) {
        if (error instanceof AwfError) {
          return { ok: false, ...(authErrorView(error)) }
        }
        return { ok: false, errorKind: 'network', errorMessage: String(error) }
      }
    },

    async authPhoneLogin(input): Promise<AwfAuthStatusView> {
      try {
        const status = await awfAuthPhoneLogin(authOptions(), input)
        log(`AWF auth: phone login ${status.email ?? ''}`)
        return status
      } catch (error) {
        if (error instanceof AwfError) {
          return { hasSession: false, ...(authErrorView(error)) }
        }
        return { hasSession: false, errorKind: 'network', errorMessage: String(error) }
      }
    },

    async authLogout() {
      await awfAuthLogout(authOptions())
      log('AWF auth: signed out')
      return { ok: true }
    },

    async getSettings(): Promise<AwfPublicStatus> {
      const settings = await currentSettings()
      const token = resolveAwfToken(settings, env ?? process.env)
      return toPublicAwfSettings(settings, token)
    },

    async setSettings(input) {
      const prev = await currentSettings()
      const next = await writeAwfSettings(stateDir, {
        baseUrl: typeof input.baseUrl === 'string' && input.baseUrl.trim() ? input.baseUrl : prev.baseUrl,
        apiTokenEnv: typeof input.apiTokenEnv === 'string' && input.apiTokenEnv.trim() ? input.apiTokenEnv : prev.apiTokenEnv,
        // 空串表示「清除已保存 token（回到 env-only）」
        apiToken: typeof input.apiToken === 'string' ? input.apiToken : prev.apiToken,
        telemetryEnabled: typeof input.telemetryEnabled === 'boolean' ? input.telemetryEnabled : prev.telemetryEnabled,
        executorEnabled: typeof input.executorEnabled === 'boolean' ? input.executorEnabled : prev.executorEnabled,
        tunnelEnabled: typeof input.tunnelEnabled === 'boolean' ? input.tunnelEnabled : prev.tunnelEnabled,
        tunnelLocalPort: typeof input.tunnelLocalPort === 'number' ? input.tunnelLocalPort : prev.tunnelLocalPort,
      })
      const token = resolveAwfToken(next, env ?? process.env)
      log(`AWF settings updated (baseUrl=${next.baseUrl}, tokenEnv=${next.apiTokenEnv})`)
      return toPublicAwfSettings(next, token)
    },

    async checkConnection(): Promise<AwfConnectionResult> {
      const settings = await currentSettings()
      try {
        const result = await clientFor(settings).checkConnection()
        return { ok: true, ...(result.email ? { email: result.email } : {}) }
      } catch (error) {
        if (error instanceof AwfError) {
          return { ok: false, errorKind: error.kind, errorMessage: error.message }
        }
        return { ok: false, errorKind: 'network', errorMessage: String(error) }
      }
    },

    async syncWorkflow(input) {
      const name = input.name.trim()
      if (!name) {
        return { ok: false, stage: 'error' as const, errorKind: 'validation', errorMessage: '工作流名称不能为空' }
      }
      let yaml = input.yaml
      if (!yaml) {
        const exported = await plugin.exportWorkflowYaml(name)
        if (exported === null) {
          return { ok: false, stage: 'error' as const, errorKind: 'not-found', errorMessage: `本地工作流不存在: ${name}` }
        }
        yaml = exported
      }
      // The platform creates the workflow from this item and its summary
      // requires a title; shipping name + yaml alone makes the create fail with
      // a bare "创建失败: <name>". Carry the local metadata through, falling
      // back to the workflow name the way template promotion does.
      const local = await plugin.getWorkflow(name).catch(() => null)
      const collabGuardInput: import('./desktop-awf-collab-guard.ts').AwfSyncGuardInput = { yaml }
      if (local?.spec.steps) collabGuardInput.steps = local.spec.steps
      if (local?.metadata.requires) collabGuardInput.requires = local.metadata.requires
      const collabGuard = assertAwfSyncAllowed(collabGuardInput)
      if (!collabGuard.ok) {
        log(`AWF sync rejected (collab): ${name}`)
        return {
          ok: false,
          stage: 'error' as const,
          errorKind: 'validation',
          errorMessage: collabGuard.error,
        }
      }
      const item: AwfSyncItem = {
        name,
        yaml_text: yaml,
        title: local?.metadata.title?.trim() || name,
        ...(local?.metadata.description?.trim() ? { description: local.metadata.description.trim() } : {}),
        ...(local?.metadata.version?.trim() ? { version: local.metadata.version.trim() } : {}),
        ...(input.visibility === 'private' || input.visibility === 'unlisted' || input.visibility === 'public'
          ? { visibility: input.visibility }
          : {}),
      }
      const settings = await currentSettings()
      const client = clientFor(settings)
      try {
        const pre = await client.syncValidate([item])
        const entry = pre[0]
        if (!entry || !entry.ok) {
          log(`AWF sync preflight rejected: ${name}`)
          return {
            ok: false,
            stage: 'preflight' as const,
            validation: entry ?? { name, ok: false, errors: [], conflict: null },
          }
        }
        const pushed = await client.syncPush([item])
        const workflow = pushed[0]
        if (!workflow) {
          return { ok: false, stage: 'error' as const, errorKind: 'server', errorMessage: '平台未返回工作流回执' }
        }
        // 服务化（awf-0bx 第一环）：同步后可选发布冻结，使其可被调用方订阅
        let status = workflow.status
        let published = false
        if (input.publish) {
          const pub = await client.publish(workflow.id)
          status = pub.status
          published = true
          log(`AWF publish ok: ${name} (id=${workflow.id})`)
        }
        log(`AWF sync pushed: ${name} → id=${workflow.id} (${status})`)
        return {
          ok: true,
          stage: 'pushed' as const,
          workflow: {
            id: workflow.id,
            name: workflow.name,
            title: workflow.title,
            status,
            visibility: workflow.visibility,
          },
          ...(input.publish ? { published } : {}),
        }
      } catch (error) {
        if (error instanceof AwfError) {
          return { ok: false, stage: 'error' as const, errorKind: error.kind, errorMessage: error.message }
        }
        return { ok: false, stage: 'error' as const, errorKind: 'network', errorMessage: String(error) }
      }
    },

    async remoteRun(input): Promise<AwfRemoteRunResult> {
      const settings = await currentSettings()
      try {
        const run = await clientFor(settings).createRun(
          input.workflowId,
          input.params ?? {},
          {
            autoApprove: false,
            ...(input.externalLoopId ? { externalLoopId: input.externalLoopId } : {}),
            ...(input.externalBranchId ? { externalBranchId: input.externalBranchId } : {}),
          },
        )
        return toRemoteRunResult(run)
      } catch (error) {
        if (error instanceof AwfError) {
          return { ok: false, errorKind: error.kind, errorMessage: error.message }
        }
        return { ok: false, errorKind: 'network', errorMessage: String(error) }
      }
    },

    async remoteRunAndWait(input, options = {}): Promise<AwfRemoteRunResult> {
      const timeoutMs = options.timeoutMs ?? 300_000
      const pollIntervalMs = options.pollIntervalMs ?? 2_000
      const settings = await currentSettings()
      const client = clientFor(settings)
      let run
      try {
        run = await client.createRun(
          input.workflowId,
          input.params ?? {},
          {
            autoApprove: false,
            ...(input.externalLoopId ? { externalLoopId: input.externalLoopId } : {}),
            ...(input.externalBranchId ? { externalBranchId: input.externalBranchId } : {}),
          },
        )
      } catch (error) {
        if (error instanceof AwfError) {
          return { ok: false, errorKind: error.kind, errorMessage: error.message }
        }
        return { ok: false, errorKind: 'network', errorMessage: String(error) }
      }

      let current = run
      const pollKey = runnerIdOf(run)
      const deadline = Date.now() + timeoutMs
      while (!AWF_REMOTE_RUN_TERMINAL.has(current.status) && Date.now() < deadline) {
        await sleep(pollIntervalMs)
        if (!pollKey) break
        try {
          current = await client.getRun(pollKey)
        } catch {
          // Keep last known status on transient poll errors until timeout.
        }
      }

      return toRemoteRunResult(current)
    },

    async resolveAwfGate(input): Promise<AwfRemoteRunResult> {
      const settings = await currentSettings()
      try {
        const run = await clientFor(settings).resolveGate(input.runnerRunId, input.token, input.decision)
        // ResolveGate may return stateOut shape (run_id) without numeric id — normalize.
        const normalized: {
          id: number
          runner_run_id?: string
          run_id?: string
          status: string
          result_text?: string
          error_text?: string
          gates?: ReadonlyArray<{ token: string; step_id?: string; resolved?: boolean }>
        } = {
          id: typeof (run as { id?: number }).id === 'number' ? (run as { id: number }).id : 0,
          status: run.status,
          runner_run_id: runnerIdOf(run) || input.runnerRunId,
        }
        const runIdAlias = (run as { run_id?: string }).run_id
        if (runIdAlias !== undefined) normalized.run_id = runIdAlias
        if (run.result_text !== undefined) normalized.result_text = run.result_text
        if (run.error_text !== undefined) normalized.error_text = run.error_text
        if (run.gates !== undefined) normalized.gates = run.gates
        return toRemoteRunResult(normalized)
      } catch (error) {
        if (error instanceof AwfError) {
          return { ok: false, errorKind: error.kind, errorMessage: error.message }
        }
        return { ok: false, errorKind: 'network', errorMessage: String(error) }
      }
    },

    async pollAwfRun(runnerRunId, options = {}): Promise<AwfRemoteRunResult> {
      const timeoutMs = options.timeoutMs ?? 300_000
      const pollIntervalMs = options.pollIntervalMs ?? 2_000
      const settings = await currentSettings()
      const client = clientFor(settings)
      let current
      try {
        current = await client.getRun(runnerRunId)
      } catch (error) {
        if (error instanceof AwfError) {
          return { ok: false, errorKind: error.kind, errorMessage: error.message }
        }
        return { ok: false, errorKind: 'network', errorMessage: String(error) }
      }
      const deadline = Date.now() + timeoutMs
      while (!AWF_REMOTE_RUN_TERMINAL.has(current.status) && Date.now() < deadline) {
        await sleep(pollIntervalMs)
        try {
          current = await client.getRun(runnerRunId)
        } catch {
          // keep last
        }
      }
      return toRemoteRunResult(current)
    },

    async pullWorkflows() {
      const settings = await currentSettings()
      return await clientFor(settings).syncPull()
    },

    async getTunnelStatus() {
      if (!tunnelClient) {
        return { connected: false, localPort: tunnelLocalPort, executorId: null, since: null, error: 'tunnel not initialized' }
      }
      return tunnelClient.status()
    },

    async setTunnelSettings(enabled: boolean, localPort: number): Promise<AwfPublicStatus> {
      const prev = await currentSettings()
      tunnelEnabled = enabled
      tunnelLocalPort = localPort
      if (enabled) {
        if (!tunnelClient) {
          tunnelClient = createTunnelClient({
            stateDir,
            localPort,
            log: (msg) => log(`[tunnel] ${msg}`),
            ...(fetchImpl ? { fetchImpl } : {}),
            ...(env ? { env } : {}),
          })
        }
        try {
          await tunnelClient.start()
        } catch (error) {
          log(`[tunnel] start failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      } else {
        if (tunnelClient) {
          await tunnelClient.stop()
          tunnelClient = null
        }
      }

      const next = await writeAwfSettings(stateDir, {
        baseUrl: prev.baseUrl,
        apiTokenEnv: prev.apiTokenEnv,
        apiToken: prev.apiToken,
        telemetryEnabled: prev.telemetryEnabled,
        executorEnabled: prev.executorEnabled,
        tunnelEnabled: tunnelEnabled,
        tunnelLocalPort: tunnelLocalPort,
      })
      const token = resolveAwfToken(next, env ?? process.env)
      return toPublicAwfSettings(next, token)
    },
  }
}
