/**
 * Persisted settings for the optional AWF platform connector.
 *
 * Canonical pure-Node home of the AWF settings module (shared by the desktop
 * plugins and the headless awf-node runner). 0600 JSON beside the state dir,
 * raw tokens never echoed to callers (fingerprint only). Token resolution
 * prefers the configured environment variable; an explicitly saved token is
 * the fallback. No credential literals live in source, examples, or tests.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const AWF_DEFAULT_BASE_URL = 'https://awf.seedwill.com'
export const AWF_DEFAULT_TOKEN_ENV = 'AWF_API_TOKEN'

export interface AwfSettings {
  /** Platform base URL, e.g. https://awf.seedwill.com */
  readonly baseUrl: string
  /** Environment variable consulted for the API token (env wins over saved token). */
  readonly apiTokenEnv: string
  /** Token saved through the UI; empty when the env var is the source. */
  readonly apiToken: string
  /**
   * 遥测上报（awf-a3c C-P4 通道⑤，默认关）：开启后本地 run 结束才上报摘要
   * （工作流名/步骤状态/token 估算/耗时，绝不含 prompt 与输出内容）。
   */
  readonly telemetryEnabled: boolean
  /** 桌面执行器（awf-a3c S-P4 PoC，默认关）：认领平台 task(executor=desktop) 并本地执行。 */
  readonly executorEnabled: boolean
  /** 反向隧道（awf-hbw Phase 3b，默认关）：建立到平台的 WebSocket 长连接并在本地暴露 OpenAI 兼容端口。 */
  readonly tunnelEnabled: boolean
  readonly tunnelLocalPort: number
}

export interface AwfPublicSettings {
  readonly baseUrl: string
  readonly apiTokenEnv: string
  readonly hasToken: boolean
  /** Fingerprint like `abcd…wxyz`; empty when no token is configured. */
  readonly tokenFingerprint: string
  readonly telemetryEnabled: boolean
  readonly executorEnabled: boolean
  readonly tunnelEnabled: boolean
}

export function defaultAwfSettings(): AwfSettings {
  return {
    baseUrl: AWF_DEFAULT_BASE_URL,
    apiTokenEnv: AWF_DEFAULT_TOKEN_ENV,
    apiToken: '',
    telemetryEnabled: false,
    executorEnabled: false,
    tunnelEnabled: false,
    tunnelLocalPort: 8787,
  }
}

export function awfSettingsPath(stateDir: string): string {
  return join(stateDir, '..', 'awf.json')
}

export function normalizeAwfBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return AWF_DEFAULT_BASE_URL
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return AWF_DEFAULT_BASE_URL
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return AWF_DEFAULT_BASE_URL
  return raw.trim().replace(/\/+$/, '')
}

export function normalizeAwfSettings(raw: Partial<AwfSettings> | undefined): AwfSettings {
  const defaults = defaultAwfSettings()
  if (!raw || typeof raw !== 'object') return defaults
  const apiTokenEnv = typeof raw.apiTokenEnv === 'string' && /^[A-Z_][A-Z0-9_]*$/.test(raw.apiTokenEnv.trim())
    ? raw.apiTokenEnv.trim()
    : defaults.apiTokenEnv
  return {
    baseUrl: normalizeAwfBaseUrl(raw.baseUrl),
    apiTokenEnv,
    apiToken: typeof raw.apiToken === 'string' ? raw.apiToken : '',
    telemetryEnabled: raw.telemetryEnabled === true,
    executorEnabled: raw.executorEnabled === true,
    tunnelEnabled: raw.tunnelEnabled === true,
    tunnelLocalPort: typeof raw.tunnelLocalPort === 'number' ? raw.tunnelLocalPort : defaults.tunnelLocalPort,
  }
}

export function tokenFingerprint(token: string): string {
  const t = token.trim()
  if (!t) return ''
  if (t.length <= 8) return `${t.slice(0, 2)}…`
  return `${t.slice(0, 4)}…${t.slice(-4)}`
}

/** Env var wins over an explicitly saved token. */
export function resolveAwfToken(settings: AwfSettings, env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env[settings.apiTokenEnv]
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  return settings.apiToken.trim()
}

export function toPublicAwfSettings(settings: AwfSettings, token: string): AwfPublicSettings {
  return {
    baseUrl: settings.baseUrl,
    apiTokenEnv: settings.apiTokenEnv,
    hasToken: token.length > 0,
    tokenFingerprint: tokenFingerprint(token),
    telemetryEnabled: settings.telemetryEnabled,
    executorEnabled: settings.executorEnabled,
    tunnelEnabled: settings.tunnelEnabled,
  }
}

export async function readAwfSettings(stateDir: string): Promise<AwfSettings> {
  try {
    const raw = await readFile(awfSettingsPath(stateDir), 'utf8')
    return normalizeAwfSettings(JSON.parse(raw) as Partial<AwfSettings>)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultAwfSettings()
    }
    throw error
  }
}

export async function writeAwfSettings(stateDir: string, settings: AwfSettings): Promise<AwfSettings> {
  const normalized = normalizeAwfSettings(settings)
  const path = awfSettingsPath(stateDir)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  return normalized
}
