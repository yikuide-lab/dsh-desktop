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
  readonly errors: ReadonlyArray<{ path: string; code: string; msg: string }>
  readonly conflict: string | null
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
  remoteRun(input: { workflowId: number; params?: Record<string, string> }): Promise<{
    ok: boolean
    status?: string
    resultText?: string
    errorText?: string
    runId?: number
    errorKind?: string
    errorMessage?: string
  }>
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

    async remoteRun(input): Promise<{
      ok: boolean
      status?: string
      resultText?: string
      errorText?: string
      runId?: number
      errorKind?: string
      errorMessage?: string
    }> {
      const settings = await currentSettings()
      try {
        const run = await clientFor(settings).createRun(input.workflowId, input.params ?? {})
        return {
          ok: true,
          status: run.status,
          ...(run.result_text !== undefined ? { resultText: run.result_text } : {}),
          ...(run.error_text !== undefined ? { errorText: run.error_text } : {}),
          runId: run.id,
        }
      } catch (error) {
        if (error instanceof AwfError) {
          return { ok: false, errorKind: error.kind, errorMessage: error.message }
        }
        return { ok: false, errorKind: 'network', errorMessage: String(error) }
      }
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
