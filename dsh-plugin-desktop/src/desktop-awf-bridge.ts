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
  setSettings(input: { baseUrl?: string; apiTokenEnv?: string; apiToken?: string }): Promise<AwfPublicStatus>
  checkConnection(): Promise<AwfConnectionResult>
  syncWorkflow(input: { name: string; yaml?: string; visibility?: string }): Promise<AwfSyncReceipt>
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
        log(`AWF sync pushed: ${name} → id=${workflow.id} (${workflow.status})`)
        return {
          ok: true,
          stage: 'pushed' as const,
          workflow: {
            id: workflow.id,
            name: workflow.name,
            title: workflow.title,
            status: workflow.status,
            visibility: workflow.visibility,
          },
        }
      } catch (error) {
        if (error instanceof AwfError) {
          return { ok: false, stage: 'error' as const, errorKind: error.kind, errorMessage: error.message }
        }
        return { ok: false, stage: 'error' as const, errorKind: 'network', errorMessage: String(error) }
      }
    },
  }
}
