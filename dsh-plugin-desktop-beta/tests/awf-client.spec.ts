import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AwfError,
  createAwfClient,
  type AwfFetch,
} from '../src/desktop-awf-client.ts'
import {
  defaultAwfSettings,
  normalizeAwfSettings,
  readAwfSettings,
  resolveAwfToken,
  tokenFingerprint,
  toPublicAwfSettings,
  writeAwfSettings,
} from '../src/desktop-awf-settings.ts'

const tmpDirs: string[] = []
afterEach(async () => {
  while (tmpDirs.length) await rm(tmpDirs.pop()!, { recursive: true, force: true })
})

async function newTmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'awf-client-spec-'))
  tmpDirs.push(dir)
  return dir
}

/** fetch mock：按路径/方法路由，token 由测试注入（无字面量凭据）。 */
function mockFetch(routes: Record<string, unknown>, opts: { status?: number; reject?: Error } = {}): AwfFetch {
  const status = opts.status ?? 200
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (opts.reject) throw opts.reject
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const key = `${method} ${url}`
    const match = Object.keys(routes).find((k) => key.includes(k))
    if (!match) {
      return new Response(JSON.stringify({ detail: 'not found' }), { status: 404 })
    }
    return new Response(JSON.stringify(routes[match]), { status })
  }) as AwfFetch
}

const TOKEN = `tok_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
const settings = { ...defaultAwfSettings(), baseUrl: 'http://awf.test' }

describe('awf settings', () => {
  it('defaults + normalization（非法 baseUrl/env 名回退默认）', () => {
    const s = normalizeAwfSettings({ baseUrl: 'ftp://x/', apiTokenEnv: 'bad name' })
    expect(s.baseUrl).toBe(defaultAwfSettings().baseUrl)
    expect(s.apiTokenEnv).toBe(defaultAwfSettings().apiTokenEnv)
    expect(normalizeAwfSettings({ baseUrl: 'http://a.test///' }).baseUrl).toBe('http://a.test')
  })

  it('round-trips through 0600 file; env var wins over saved token', async () => {
    const dir = await newTmp()
    await writeAwfSettings(join(dir, 'workflow'), { ...settings, apiToken: 'saved-token' })
    const mode = (await stat(join(dir, 'awf.json'))).mode & 0o777
    expect(mode).toBe(0o600)
    const loaded = await readAwfSettings(join(dir, 'workflow'))
    expect(loaded.apiToken).toBe('saved-token')
    expect(resolveAwfToken(loaded, { AWF_API_TOKEN: TOKEN })).toBe(TOKEN)
    expect(resolveAwfToken(loaded, {})).toBe('saved-token')
  })

  it('public settings only expose a fingerprint', () => {
    const pub = toPublicAwfSettings(settings, TOKEN)
    expect(pub.hasToken).toBe(true)
    expect(pub.tokenFingerprint).toBe(tokenFingerprint(TOKEN))
    expect(JSON.stringify(pub)).not.toContain(TOKEN)
    expect(tokenFingerprint('short')).toBe('sh…')
  })

  it('corrupt file fails loudly rather than silently resetting', async () => {
    const dir = await newTmp()
    const path = join(dir, 'awf.json')
    await writeFile(path, '{oops', 'utf8')
    await expect(readAwfSettings(join(dir, 'workflow'))).rejects.toBeTruthy()
  })
})

describe('awf client', () => {
  it('checkConnection：health + me', async () => {
    const client = createAwfClient(settings, {
      fetchImpl: mockFetch({
        'GET http://awf.test/health': { ok: true },
        'GET http://awf.test/api/auth/me': { email: 'u@test.local' },
      }),
      token: TOKEN,
    })
    const r = await client.checkConnection()
    expect(r).toEqual({ ok: true, email: 'u@test.local' })
  })

  it('network failure → AwfError(network)', async () => {
    const client = createAwfClient(settings, { fetchImpl: mockFetch({}, { reject: new Error('econnrefused') }), token: TOKEN })
    await expect(client.checkConnection()).rejects.toMatchObject({ name: 'AwfError', kind: 'network' })
  })

  it('401 → auth；409 → conflict；400 → validation（带明细）', async () => {
    const cases: Array<{ status: number; body: unknown; kind: string }> = [
      { status: 401, body: { detail: 'token 无效' }, kind: 'auth' },
      { status: 409, body: { detail: '工作流已发布冻结' }, kind: 'conflict' },
      { status: 400, body: { detail: { name: 'w', errors: [{ path: 'spec.steps[0]', code: 'bad_id', msg: 'x' }] } }, kind: 'validation' },
    ]
    for (const c of cases) {
      const client = createAwfClient(settings, {
        fetchImpl: mockFetch({ 'POST http://awf.test/api/sync/validate': c.body }, { status: c.status }),
        token: TOKEN,
      })
      const err = (await client.syncValidate([{ name: 'w', yaml_text: '' }]).catch((e) => e)) as AwfError
      expect(err).toBeInstanceOf(AwfError)
      expect(err.kind).toBe(c.kind)
    }
  })

  it('syncValidate / syncPush / syncPull happy path', async () => {
    const client = createAwfClient(settings, {
      fetchImpl: mockFetch({
        'POST http://awf.test/api/sync/validate': [{ name: 'w', ok: true, errors: [], conflict: null }],
        'POST http://awf.test/api/sync/workflows': [{ id: 7, name: 'w', title: 'W', status: 'draft', visibility: 'private' }],
        'GET http://awf.test/api/sync/workflows': [{ id: 7, name: 'w', title: 'W', status: 'draft', visibility: 'private' }],
      }),
      token: TOKEN,
    })
    expect((await client.syncValidate([{ name: 'w', yaml_text: 'a: 1' }]))[0]?.ok).toBe(true)
    expect((await client.syncPush([{ name: 'w', yaml_text: 'a: 1' }]))[0]?.id).toBe(7)
    expect((await client.syncPull())[0]?.name).toBe('w')
  })

  it('capabilities goes out unauthenticated-friendly and maps fields', async () => {
    let sawAuthHeader = false
    const fetchImpl: AwfFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sawAuthHeader = Boolean((init?.headers as Record<string, string>)?.Authorization)
      return new Response(
        JSON.stringify({
          dsl_version: 'workflow-wise/v1',
          base_step_types: ['script', 'llm', 'sub_workflow'],
          platform_extension_types: ['bloom'],
          features: { gate: true, sub_workflow: true, compensation: false },
        }),
        { status: 200 },
      )
    }) as AwfFetch
    const caps = await createAwfClient(settings, { fetchImpl, token: TOKEN }).capabilities()
    expect(caps.base_step_types).toContain('sub_workflow')
    expect(caps.platform_extension_types).toContain('bloom')
    expect(sawAuthHeader).toBe(false) // 匿名端点不携带 token，减小凭据暴露面
  })

  it('run + gate resolve use the platform REST contract', async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = []
    const fetchImpl: AwfFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ method: (init?.method ?? 'GET').toUpperCase(), url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url.endsWith('/api/workflows/9/runs') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 31, runner_run_id: 'run_x', run_id: 'run_x', status: 'completed', result_text: 'ok' }), { status: 200 })
      }
      if (url.includes('/gates/')) {
        return new Response(JSON.stringify({ id: 31, runner_run_id: 'run_x', status: 'completed' }), { status: 200 })
      }
      if (url.includes('/api/workflows/runs/run_uuid')) {
        return new Response(JSON.stringify({ id: 31, runner_run_id: 'run_uuid', run_id: 'run_uuid', status: 'waiting_gate', gates: [{ token: 't1', resolved: false }] }), { status: 200 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    }) as AwfFetch
    const client = createAwfClient(settings, { fetchImpl, token: TOKEN })
    const run = await client.createRun(9, { PROMPT: 'hi' })
    expect(run.status).toBe('completed')
    // 默认 auto_approve=false：与本地引擎「审批等待人工」对齐（双跑一致）
    expect(calls[0]?.body).toMatchObject({ auto_approve: false })
    await client.createRun(9, {}, {
      autoApprove: true,
      externalLoopId: 'loop-1',
      externalBranchId: 'br-1',
    })
    expect(calls[1]?.body).toMatchObject({
      auto_approve: true,
      external_loop_id: 'loop-1',
      external_branch_id: 'br-1',
    })
    await client.resolveGate(31, 'gate-token', 'approved')
    expect(calls[2]?.url).toBe('http://awf.test/api/workflows/runs/31/gates/gate-token')
    expect(calls[2]?.body).toMatchObject({ decision: 'approved' })
    // 保留字符必须被编码，防路径注入/语义改变
    await client.resolveGate(31, 'a/b?c=d', 'approved')
    expect(calls[3]?.url).toBe('http://awf.test/api/workflows/runs/31/gates/a%2Fb%3Fc%3Dd')
    const got = await client.getRun('run_uuid')
    expect(got.status).toBe('waiting_gate')
    expect(calls[4]?.url).toBe('http://awf.test/api/workflows/runs/run_uuid')
    await client.resolveGate('run_uuid', 't1', 'approved')
    expect(calls[5]?.url).toBe('http://awf.test/api/workflows/runs/run_uuid/gates/t1')

    const mintCalls: Array<{ url: string; auth?: string | null; body: unknown }> = []
    const mintFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const auth = init?.headers && typeof init.headers === 'object' && 'Authorization' in (init.headers as Record<string, string>)
        ? (init.headers as Record<string, string>).Authorization
        : null
      let body: unknown = null
      if (init?.body && typeof init.body === 'string') body = JSON.parse(init.body)
      mintCalls.push({ url, auth, body })
      if (url.includes('/gate-delegates')) {
        return new Response(JSON.stringify({
          delegate_token: 'del-tok',
          expires_at: '2099-01-01T00:00:00Z',
          run_id: 'run_uuid',
          ttl_seconds: 120,
          gate_token: 't1',
        }), { status: 200 })
      }
      if (url.includes('/gates/')) {
        return new Response(JSON.stringify({ run_id: 'run_uuid', status: 'completed' }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }) as AwfFetch
    const mintClient = createAwfClient(settings, { fetchImpl: mintFetch, token: TOKEN })
    const minted = await mintClient.createGateDelegate('run_uuid', { gateToken: 't1', ttlSeconds: 120 })
    expect(minted.delegate_token).toBe('del-tok')
    expect(mintCalls[0]?.url).toBe('http://awf.test/api/workflows/runs/run_uuid/gate-delegates')
    expect(mintCalls[0]?.body).toMatchObject({ gate_token: 't1', ttl_seconds: 120 })
    await mintClient.resolveGate('run_uuid', 't1', 'approved', { delegateToken: 'del-tok' })
    expect(mintCalls[1]?.auth).toBe('Bearer del-tok')
  })
})
