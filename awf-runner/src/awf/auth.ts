/**
 * Optional AWF account session (shared by the desktop plugins and awf-node).
 *
 * 注册/登录（邮箱+密码、手机号+验证码）直接完成，免去「先去平台复制 token」的
 * 手工步骤。会话文件 awf-auth.json（0600，与 awf.json 同目录）只存 refresh
 * token 与短时效 access token —— **密码绝不落盘**；调用方只见指纹。
 * Token 解析链：env AWF_API_TOKEN > 手动保存 token > 登录会话（自动刷新）。
 * 退出登录会尽力调用平台 POST /api/auth/logout 吊销当前会话的 refresh token
 * （网络/HTTP 失败一律吞掉），随后始终清除本地会话文件。
 * 微信登录需要平台配置微信开放平台应用（GET /api/auth/methods 如实上报），
 * 未配置前客户端如实显示不可用。
 */

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AwfFetch } from './client.js'
import { AwfError } from './client.js'
import { readAwfSettings } from './settings.js'
import { tokenFingerprint } from './settings.js'

/** 会话在 access token 过期前多久就主动刷新（余量）。 */
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60_000

export interface AwfAuthOptions {
  readonly stateDir: string
  readonly fetchImpl?: AwfFetch
  readonly env?: Record<string, string | undefined>
}

export interface AwfAuthSession {
  readonly email: string
  readonly displayName: string
  readonly refreshToken: string
  readonly accessToken: string
  readonly accessTokenExpiresAt: string
}

export interface AwfAuthStatusView {
  readonly hasSession: boolean
  readonly email?: string
  readonly displayName?: string
  readonly tokenFingerprint?: string
  readonly accessTokenExpiresAt?: string
  /** 失败时携带（与 AwfConnectionResult 字段对齐）；成功时缺省。 */
  readonly errorKind?: string
  readonly errorMessage?: string
}

export interface AwfAuthMethods {
  readonly email: boolean
  readonly phone: boolean
  readonly wechat: boolean
  readonly wechatReason?: string
}

interface TokenPair {
  readonly access_token: string
  readonly refresh_token: string
  readonly expires_in: number
}

/** 会话文件（0600，与 awf.json 同目录）。 */
export function awfAuthSessionPath(stateDir: string): string {
  return join(stateDir, '..', 'awf-auth.json')
}

export async function readAuthSession(stateDir: string): Promise<AwfAuthSession | null> {
  try {
    const raw = await readFile(awfAuthSessionPath(stateDir), 'utf8')
    const parsed = JSON.parse(raw) as Partial<AwfAuthSession>
    if (
      typeof parsed.email === 'string' && parsed.email
      && typeof parsed.refreshToken === 'string' && parsed.refreshToken
      && typeof parsed.accessToken === 'string' && parsed.accessToken
      && typeof parsed.accessTokenExpiresAt === 'string' && parsed.accessTokenExpiresAt
    ) {
      return {
        email: parsed.email,
        displayName: typeof parsed.displayName === 'string' ? parsed.displayName : '',
        refreshToken: parsed.refreshToken,
        accessToken: parsed.accessToken,
        accessTokenExpiresAt: parsed.accessTokenExpiresAt,
      }
    }
    return null
  } catch {
    return null
  }
}

async function writeAuthSession(stateDir: string, session: AwfAuthSession): Promise<void> {
  const path = awfAuthSessionPath(stateDir)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(session, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

async function clearAuthSessionFile(stateDir: string): Promise<void> {
  await rm(awfAuthSessionPath(stateDir), { force: true })
}

async function awfBase(options: AwfAuthOptions): Promise<string> {
  const settings = await readAwfSettings(options.stateDir)
  return settings.baseUrl.replace(/\/+$/, '')
}

async function authRequest(options: AwfAuthOptions, path: string, body: unknown): Promise<TokenPair> {
  const doFetch = options.fetchImpl ?? fetch
  let response: Response
  try {
    response = await doFetch(`${await awfBase(options)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new AwfError('network', `无法连接 AWF 平台`, null, error)
  }
  const text = await response.text()
  let payload: Record<string, unknown> = {}
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    payload = {}
  }
  if (!response.ok) {
    const detail = typeof payload.detail === 'string' ? payload.detail : `HTTP ${response.status}`
    throw new AwfError(response.status === 401 ? 'auth' : 'validation', detail, response.status, payload)
  }
  if (typeof payload.access_token !== 'string' || typeof payload.refresh_token !== 'string') {
    throw new AwfError('server', '平台鉴权响应不完整', response.status, payload)
  }
  return payload as unknown as TokenPair
}

async function saveFromPair(
  stateDir: string,
  previous: AwfAuthSession | null,
  pair: TokenPair,
): Promise<AwfAuthSession> {
  const expiresAt = new Date(Date.now() + Math.max(1, pair.expires_in || 1800) * 1000).toISOString()
  const session: AwfAuthSession = {
    email: previous?.email ?? '',
    displayName: previous?.displayName ?? '',
    refreshToken: pair.refresh_token,
    accessToken: pair.access_token,
    accessTokenExpiresAt: expiresAt,
  }
  await writeAuthSession(stateDir, session)
  return session
}

function sessionFromIdentity(
  stateDir: string,
  identity: { email: string; displayName?: string },
  pair: TokenPair,
): Promise<AwfAuthSession> {
  return saveFromPair(stateDir, {
    email: identity.email.trim().toLowerCase(),
    displayName: identity.displayName?.trim() ?? '',
    refreshToken: '',
    accessToken: '',
    accessTokenExpiresAt: '',
  }, pair)
}

export async function awfAuthRegister(
  options: AwfAuthOptions,
  input: { email: string; password: string; displayName?: string },
): Promise<AwfAuthStatusView> {
  const email = input.email.trim().toLowerCase()
  if (!email.includes('@')) throw new AwfError('validation', '邮箱格式不正确', null)
  if (input.password.length < 6) throw new AwfError('validation', '密码至少 6 位', null)
  const pair = await authRequest(options, '/api/auth/register', {
    email,
    password: input.password,
    ...(input.displayName?.trim() ? { display_name: input.displayName.trim() } : {}),
  })
  const session = await sessionFromIdentity(options.stateDir, {
    email,
    ...(input.displayName?.trim() ? { displayName: input.displayName.trim() } : {}),
  }, pair)
  return toAuthStatus(session)
}

export async function awfAuthLogin(
  options: AwfAuthOptions,
  input: { email: string; password: string },
): Promise<AwfAuthStatusView> {
  const email = input.email.trim().toLowerCase()
  const pair = await authRequest(options, '/api/auth/login', { email, password: input.password })
  const existing = await readAuthSession(options.stateDir)
  const displayName = existing && existing.email === email ? existing.displayName : ''
  const session = await saveFromPair(options.stateDir, {
    email,
    displayName,
    refreshToken: '',
    accessToken: '',
    accessTokenExpiresAt: '',
  }, pair)
  return toAuthStatus(session)
}

export async function awfAuthSendPhoneCode(options: AwfAuthOptions, phone: string): Promise<void> {
  const doFetch = options.fetchImpl ?? fetch
  let response: Response
  try {
    response = await doFetch(`${await awfBase(options)}/api/auth/phone/send-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phone.trim() }),
    })
  } catch (error) {
    throw new AwfError('network', '无法连接 AWF 平台', null, error)
  }
  if (!response.ok) {
    const detail = await response.json().then((d) => (d as { detail?: unknown }).detail).catch(() => null)
    throw new AwfError('validation', typeof detail === 'string' ? detail : `HTTP ${response.status}`, response.status)
  }
}

export async function awfAuthPhoneLogin(
  options: AwfAuthOptions,
  input: { phone: string; code: string },
): Promise<AwfAuthStatusView> {
  const pair = await authRequest(options, '/api/auth/phone/login', {
    phone: input.phone.trim(),
    code: input.code.trim(),
  })
  const me = await fetchMe(options, pair.access_token)
  const session = await sessionFromIdentity(options.stateDir, {
    email: me.email ?? `phone:${input.phone.trim()}`,
    ...(me.display_name ? { displayName: me.display_name } : {}),
  }, pair)
  return toAuthStatus(session)
}

async function fetchMe(
  options: AwfAuthOptions,
  accessToken: string,
): Promise<{ email?: string; display_name?: string }> {
  const doFetch = options.fetchImpl ?? fetch
  const response = await doFetch(`${await awfBase(options)}/api/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) return {}
  return (await response.json()) as { email?: string; display_name?: string }
}

/**
 * 退出登录：有会话时尽力 POST /api/auth/logout 吊销当前 refresh token
 * （Bearer access token 鉴权；网络/HTTP 失败 —— 含 access token 过期的 401 —— 一律吞掉），
 * 随后始终清除本地会话文件。
 */
export async function awfAuthLogout(options: AwfAuthOptions): Promise<void> {
  const session = await readAuthSession(options.stateDir)
  if (session) {
    const doFetch = options.fetchImpl ?? fetch
    try {
      await doFetch(`${await awfBase(options)}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({ refresh_token: session.refreshToken }),
      })
    } catch {
      // best-effort：平台不可达或拒绝都不阻塞本地退出
    }
  }
  await clearAuthSessionFile(options.stateDir)
}

export function toAuthStatus(session: AwfAuthSession | null): AwfAuthStatusView {
  if (!session) return { hasSession: false }
  return {
    hasSession: true,
    email: session.email,
    ...(session.displayName ? { displayName: session.displayName } : {}),
    tokenFingerprint: tokenFingerprint(session.refreshToken),
    accessTokenExpiresAt: session.accessTokenExpiresAt,
  }
}

/** 当前账号状态（无 token 明文，仅指纹）。 */
export async function awfAuthStatus(options: AwfAuthOptions): Promise<AwfAuthStatusView> {
  return toAuthStatus(await readAuthSession(options.stateDir))
}

/** 平台登录方式能力（微信是否可用由平台如实上报）。 */
export async function awfAuthMethods(options: AwfAuthOptions): Promise<AwfAuthMethods> {
  const doFetch = options.fetchImpl ?? fetch
  let response: Response
  try {
    response = await doFetch(`${await awfBase(options)}/api/auth/methods`)
  } catch (error) {
    throw new AwfError('network', '无法连接 AWF 平台', null, error)
  }
  if (!response.ok) throw new AwfError('server', `HTTP ${response.status}`, response.status)
  const body = (await response.json()) as {
    email?: boolean
    phone?: boolean
    wechat?: boolean
    wechat_reason?: string
  }
  return {
    email: body.email === true,
    phone: body.phone === true,
    wechat: body.wechat === true,
    ...(body.wechat_reason ? { wechatReason: body.wechat_reason } : {}),
  }
}

/**
 * 当前可用的会话 access token：临近过期自动刷新（refresh 旋转后立即落盘）。
 * 无会话或刷新失败（refresh 失效则清会话）返回 null，由调用方回退其他凭据源。
 */
export async function awfAuthAccessToken(options: AwfAuthOptions): Promise<string | null> {
  const session = await readAuthSession(options.stateDir)
  if (!session) return null
  const expiresAt = Date.parse(session.accessTokenExpiresAt)
  if (Number.isFinite(expiresAt) && expiresAt - ACCESS_TOKEN_REFRESH_MARGIN_MS > Date.now()) {
    return session.accessToken
  }
  return awfAuthRefresh(options)
}

/** 强制刷新会话；失败（refresh 失效/过期）清会话并返回 null。 */
export async function awfAuthRefresh(options: AwfAuthOptions): Promise<string | null> {
  const session = await readAuthSession(options.stateDir)
  if (!session) return null
  try {
    const pair = await authRequest(options, '/api/auth/refresh', { refresh_token: session.refreshToken })
    await saveFromPair(options.stateDir, session, pair)
    const updated = await readAuthSession(options.stateDir)
    return updated?.accessToken ?? null
  } catch {
    await clearAuthSessionFile(options.stateDir)
    return null
  }
}
