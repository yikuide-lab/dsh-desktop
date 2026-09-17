/**
 * Host-side AWF connector bridge: settings + connection check + sync-to-AWF action.
 *
 * Wraps desktop-awf-client for the Desktop workflow op layer. Credentials follow
 * the settings module rules (env var first, 0600 saved file, fingerprint-only
 * status). Sync always preflights (POST /api/sync/validate) before pushing.
 */

import type { WorkflowPlugin } from 'dsh-plugin-workflow'
import { AwfError, createAwfClient, type AwfFetch, type AwfSyncItem } from './desktop-awf-client.ts'
import {
  readAwfSettings,
  resolveAwfToken,
  toPublicAwfSettings,
  writeAwfSettings,
  type AwfSettings,
} from './desktop-awf-settings.ts'

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
  }): Promise<AwfPublicStatus>
  checkConnection(): Promise<AwfConnectionResult>
  syncWorkflow(input: { name: string; yaml?: string; visibility?: string; publish?: boolean }): Promise<AwfSyncReceipt>
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
}

export function createAwfBridge(options: AwfBridgeOptions): AwfBridge {
  const { plugin, stateDir } = options
  const log = options.log ?? ((): void => {})
  const fetchImpl = options.fetchImpl
  const env = options.env

  async function currentSettings(): Promise<AwfSettings> {
    return readAwfSettings(stateDir)
  }

  function clientFor(settings: AwfSettings) {
    return createAwfClient(settings, {
      ...(fetchImpl ? { fetchImpl } : {}),
      ...(env ? { env } : {}),
    })
  }

  return {
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
      const item: AwfSyncItem = {
        name,
        yaml_text: yaml,
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
  }
}
