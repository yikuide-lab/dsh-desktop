/**
 * awf 平台账号（可选注册/登录）：会话 0600 落盘且不含密码、token 解析链回退会话、
 * access token 过期自动刷新、401 重试一次，以及退出清理。
 * 凭据一律运行时随机派生（仓库红线：源码/测试无凭据字面量）。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createAwfBridge } from '../src/desktop-awf-bridge.ts'
import { createAwfClient, type AwfFetch } from '../src/desktop-awf-client.ts'
import { defaultAwfSettings } from '../src/desktop-awf-settings.ts'
import {
  awfAuthAccessToken,
  awfAuthLogin,
  awfAuthLogout,
  awfAuthMethods,
  awfAuthPhoneLogin,
  awfAuthRegister,
  awfAuthSessionPath,
  awfAuthStatus,
} from '../src/desktop-awf-auth.ts'

const tmpDirs: string[] = []
afterEach(async () => {
  while (tmpDirs.length) await rm(tmpDirs.pop()!, { recursive: true, force: true })
})

const PASSWORD = `pw-${randomBytes(9).toString('hex')}`
const ACC_1 = `acc-${randomBytes(8).toString('hex')}`
const ACC_2 = `acc-${randomBytes(8).toString('hex')}`
const REF_1 = `ref-${randomBytes(8).toString('hex')}`
const REF_2 = `ref-${randomBytes(8).toString('hex')}`
const REF_STALE = `ref-${randomBytes(8).toString('hex')}`
const PAIR_1 = { access_token: ACC_1, refresh_token: REF_1, token_type: 'bearer', expires_in: 1800 }
const PAIR_2 = { access_token: ACC_2, refresh_token: REF_2, token_type: 'bearer', expires_in: 1800 }

async function newStateDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'awf-auth-spec-'))
  tmpDirs.push(dir)
  // 会话文件写在 stateDir 上级目录：嵌套子目录避免用例间共享
  return join(dir, 'workflow')
}

type Responder = (method: string, url: string, body: unknown, auth: string | null) =>
  { status: number; body: unknown } | null

function scriptedFetch(responders: Responder[]): { fetchImpl: AwfFetch; requests: Array<{ method: string; url: string; body: unknown; auth: string | null }> } {
  const requests: Array<{ method: string; url: string; body: unknown; auth: string | null }> = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) : null
    const auth = (init?.headers as Record<string, string>)?.Authorization ?? null
    requests.push({ method, url, body, auth })
    for (const responder of responders) {
      const out = responder(method, url, body, auth)
      if (out) return new Response(JSON.stringify(out.body), { status: out.status })
    }
    return new Response(JSON.stringify({ detail: 'not found' }), { status: 404 })
  }) as AwfFetch
  return { fetchImpl, requests }
}

describe('awf 平台账号（可选注册/登录）', () => {
  it('邮箱注册：会话 0600 落盘、不含密码、状态只见指纹', async () => {
    const stateDir = await newStateDir()
    const { fetchImpl } = scriptedFetch([
      (method, url) => (method === 'POST' && url.includes('/api/auth/register')
        ? { status: 200, body: PAIR_1 }
        : null),
    ])
    const status = await awfAuthRegister({ stateDir, fetchImpl }, {
      email: 'User@Example.com',
      password: PASSWORD,
      displayName: '开发者',
    })
    expect(status.hasSession).toBe(true)
    expect(status.email).toBe('user@example.com')
    expect(status.displayName).toBe('开发者')
    expect(status.tokenFingerprint).toBeTruthy()

    const path = awfAuthSessionPath(stateDir)
    expect(((await stat(path)).mode & 0o777)).toBe(0o600)
    const raw = await readFile(path, 'utf8')
    expect(raw).not.toContain(PASSWORD)
    expect(raw).toContain(REF_1)
  })

  it('登录 + 过期自动刷新（refresh 旋转落盘）+ 退出清理', async () => {
    const stateDir = await newStateDir()
    let loginCount = 0
    let refreshCount = 0
    const { fetchImpl } = scriptedFetch([
      (method, url) => {
        if (method === 'POST' && url.includes('/api/auth/login')) {
          loginCount += 1
          return { status: 200, body: PAIR_1 }
        }
        if (method === 'POST' && url.includes('/api/auth/refresh')) {
          refreshCount += 1
          // 只接受最新 refresh token（平台旋转语义）
          return { status: 200, body: PAIR_2 }
        }
        return null
      },
    ])
    const opts = { stateDir, fetchImpl }
    await awfAuthLogin(opts, { email: 'user@example.com', password: PASSWORD })
    expect(loginCount).toBe(1)

    // access token 未过期：直接复用，不触发刷新
    expect(await awfAuthAccessToken(opts)).toBe(ACC_1)
    expect(refreshCount).toBe(0)

    // 模拟过期：把过期时间改到过去 → 触发刷新并落盘旋转后的凭据
    const path = awfAuthSessionPath(stateDir)
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { accessTokenExpiresAt: string }
    parsed.accessTokenExpiresAt = new Date(Date.now() - 1000).toISOString()
    await (await import('node:fs/promises')).writeFile(path, JSON.stringify(parsed), { encoding: 'utf8', mode: 0o600 })
    expect(await awfAuthAccessToken(opts)).toBe(ACC_2)
    expect(refreshCount).toBe(1)
    const rotated = JSON.parse(await readFile(path, 'utf8')) as { refreshToken: string }
    expect(rotated.refreshToken).toBe(REF_2)

    await awfAuthLogout(opts)
    expect((await awfAuthStatus(opts)).hasSession).toBe(false)
  })

  it('退出登录：POST /api/auth/logout 吊销 refresh token（Bearer 鉴权）', async () => {
    const stateDir = await newStateDir()
    const { fetchImpl, requests } = scriptedFetch([
      (method, url) => {
        if (method === 'POST' && url.includes('/api/auth/login')) return { status: 200, body: PAIR_1 }
        if (method === 'POST' && url.includes('/api/auth/logout')) return { status: 200, body: {} }
        return null
      },
    ])
    const opts = { stateDir, fetchImpl }
    await awfAuthLogin(opts, { email: 'user@example.com', password: PASSWORD })

    await awfAuthLogout(opts)
    const logoutReq = requests.find((r) => r.url.includes('/api/auth/logout'))
    expect(logoutReq).toBeTruthy()
    expect(logoutReq!.method).toBe('POST')
    expect(logoutReq!.auth).toBe(`Bearer ${ACC_1}`)
    expect(logoutReq!.body).toEqual({ refresh_token: REF_1 })
    expect((await awfAuthStatus(opts)).hasSession).toBe(false)
  })

  it('退出登录：平台拒绝（401）或网络抛错也照常清除本地会话', async () => {
    // 平台返回 401（access token 已过期）：本地会话仍被清除
    const stateDir = await newStateDir()
    const { fetchImpl, requests } = scriptedFetch([
      (method, url) => {
        if (method === 'POST' && url.includes('/api/auth/login')) return { status: 200, body: PAIR_1 }
        if (method === 'POST' && url.includes('/api/auth/logout')) return { status: 401, body: { detail: 'token 过期' } }
        return null
      },
    ])
    const opts = { stateDir, fetchImpl }
    await awfAuthLogin(opts, { email: 'user@example.com', password: PASSWORD })
    await awfAuthLogout(opts)
    expect(requests.some((r) => r.url.includes('/api/auth/logout'))).toBe(true)
    expect((await awfAuthStatus(opts)).hasSession).toBe(false)

    // logout 请求直接抛网络错误：本地会话仍被清除
    const stateDir2 = await newStateDir()
    const { fetchImpl: fetchImpl2 } = scriptedFetch([
      (method, url) => (method === 'POST' && url.includes('/api/auth/login') ? { status: 200, body: PAIR_1 } : null),
    ])
    const opts2 = { stateDir: stateDir2, fetchImpl: fetchImpl2 }
    await awfAuthLogin(opts2, { email: 'user@example.com', password: PASSWORD })
    const throwingFetch = (async () => {
      throw new Error('network down')
    }) as AwfFetch
    await awfAuthLogout({ stateDir: stateDir2, fetchImpl: throwingFetch })
    expect((await awfAuthStatus(opts2)).hasSession).toBe(false)
  })

  it('refresh 失效：清空会话并返回 null（回退无凭据）', async () => {
    const stateDir = await newStateDir()
    const { fetchImpl } = scriptedFetch([
      (method, url) => (method === 'POST' && url.includes('/api/auth/refresh')
        ? { status: 401, body: { detail: 'refresh token 无效' } }
        : null),
    ])
    const opts = { stateDir, fetchImpl }
    // 手工放置一个已过期会话
    const { writeFile: wf, mkdir } = await import('node:fs/promises')
    const { dirname } = await import('node:path')
    const path = awfAuthSessionPath(stateDir)
    await mkdir(dirname(path), { recursive: true })
    await wf(path, JSON.stringify({
      email: 'stale@example.com',
      displayName: '',
      refreshToken: REF_STALE,
      accessToken: `acc-${randomBytes(6).toString('hex')}`,
      accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    }), { encoding: 'utf8', mode: 0o600 })

    expect(await awfAuthAccessToken(opts)).toBeNull()
    expect((await awfAuthStatus(opts)).hasSession).toBe(false)
  })

  it('手机验证码登录：/me 身份回填 + 微信能力如实上报', async () => {
    const stateDir = await newStateDir()
    const { fetchImpl } = scriptedFetch([
      (method, url) => {
        if (method === 'POST' && url.includes('/api/auth/phone/send-code')) return { status: 200, body: { ok: true } }
        if (method === 'POST' && url.includes('/api/auth/phone/login')) return { status: 200, body: PAIR_1 }
        if (method === 'GET' && url.endsWith('/api/auth/methods')) {
          return { status: 200, body: { email: true, phone: true, wechat: false, wechat_reason: '平台未配置微信开放平台应用' } }
        }
        if (method === 'GET' && url.endsWith('/api/auth/me')) {
          return { status: 200, body: { email: 'phone-x@phone.awf.local', display_name: '手机用户1111' } }
        }
        return null
      },
    ])
    const opts = { stateDir, fetchImpl }
    const status = await awfAuthPhoneLogin(opts, { phone: '+8613800001111', code: '482913' })
    expect(status.hasSession).toBe(true)
    expect(status.email).toBe('phone-x@phone.awf.local')
    expect(status.displayName).toBe('手机用户1111')

    const methods = await awfAuthMethods(opts)
    expect(methods.email).toBe(true)
    expect(methods.phone).toBe(true)
    expect(methods.wechat).toBe(false)
    expect(methods.wechatReason).toContain('微信')
  })

  it('client 401 → onAuthFailure 刷新 → 重试一次成功；tokenProvider 优先于静态 token', async () => {
    const settings = { ...defaultAwfSettings(), baseUrl: 'http://awf.test' }
    const STATIC_TOKEN = `static-${randomBytes(6).toString('hex')}`
    const SESSION_TOKEN = `sess-${randomBytes(6).toString('hex')}`
    const FRESH_TOKEN = `fresh-${randomBytes(6).toString('hex')}`
    const seenAuth: Array<string | null> = []
    let first = true
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/sync/workflows')) {
        seenAuth.push((init?.headers as Record<string, string>)?.Authorization ?? null)
        if (first) {
          first = false
          return new Response(JSON.stringify({ detail: 'token 过期' }), { status: 401 })
        }
        return new Response(JSON.stringify([]), { status: 200 })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    }) as AwfFetch
    const client = createAwfClient(settings, {
      fetchImpl,
      token: STATIC_TOKEN,
      tokenProvider: async () => SESSION_TOKEN,
      onAuthFailure: async () => FRESH_TOKEN,
    })
    const out = await client.syncPull()
    expect(out).toEqual([])
    expect(seenAuth).toEqual([`Bearer ${SESSION_TOKEN}`, `Bearer ${FRESH_TOKEN}`])
  })
})

describe('bridge 账号链路', () => {
  it('无 env/手动 token 时：会话凭据自动用于连接检查', async () => {
    const root = await mkdtemp(join(tmpdir(), 'awf-auth-bridge-'))
    tmpDirs.push(root)
    const stateDir = join(root, 'workflow')
    const { fetchImpl } = scriptedFetch([
      (_method, url, _body, auth) => {
        if (url.includes('/api/auth/login')) return { status: 200, body: PAIR_1 }
        if (url.includes('/health')) return { status: 200, body: { ok: true } }
        if (url.includes('/api/auth/me')) {
          // 只接受会话 access token
          return auth === `Bearer ${ACC_1}`
            ? { status: 200, body: { email: 'user@example.com' } }
            : { status: 401, body: { detail: 'bad token' } }
        }
        return null
      },
    ])
    const bridge = createAwfBridge({
      plugin: {} as never,
      stateDir,
      fetchImpl,
    })
    const before = await bridge.authStatus()
    expect(before.hasSession).toBe(false)
    await bridge.authLogin({ email: 'user@example.com', password: PASSWORD })
    const conn = await bridge.checkConnection()
    expect(conn.ok).toBe(true)
    expect((conn as { email?: string }).email).toBe('user@example.com')
  })
})
