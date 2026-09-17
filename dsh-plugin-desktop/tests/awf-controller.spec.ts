import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { WorkflowPlugin } from 'dsh-plugin-workflow'
import { executeDesktopWorkflowOp } from '../src/desktop-workflow-controller.ts'
import { createAwfBridge } from '../src/desktop-awf-bridge.ts'
import type { AwfFetch } from '../src/desktop-awf-client.ts'

const tmpDirs: string[] = []
afterEach(async () => {
  while (tmpDirs.length) await rm(tmpDirs.pop()!, { recursive: true, force: true })
})

const TOKEN = `tok_${randomBytes(16).toString('hex')}`

const WF_YAML = `apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: bridge-demo
spec:
  steps:
    - id: say
      type: script
      run: echo hi
`

async function fixture(routes: Record<string, unknown>, status = 200) {
  const root = await mkdtemp(join(tmpdir(), 'awf-bridge-spec-'))
  tmpDirs.push(root)
  const stateDir = join(root, 'workflow')
  const plugin = new WorkflowPlugin({ stateDir })
  await plugin.init()
  await plugin.createWorkflow(WF_YAML)
  const allRoutes: Record<string, unknown> = { 'GET http://127.0.0.1:8000/health': { ok: true }, ...routes }
  const calls: Array<{ method: string; url: string; body?: unknown; auth?: string }> = []
  const fetchImpl: AwfFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({
      method: (init?.method ?? 'GET').toUpperCase(),
      url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: (init?.headers as Record<string, string>)?.Authorization ?? '',
    })
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${url}`
    if (url.endsWith('/health')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    const match = Object.keys(allRoutes).find((k) => key.includes(k))
    if (!match) return new Response(JSON.stringify({ detail: 'not found' }), { status: 404 })
    return new Response(JSON.stringify(allRoutes[match]), { status })
  }) as AwfFetch
  const bridge = createAwfBridge({
    plugin,
    stateDir,
    fetchImpl,
    env: { AWF_API_TOKEN: TOKEN },
  })
  return { root, stateDir, plugin, bridge, calls }
}

describe('awf bridge + controller wiring', () => {
  it('awfGetSettings 默认状态：指纹可见、令牌不泄露', async () => {
    const { bridge } = await fixture({})
    const status = await bridge.getSettings()
    expect(status.hasToken).toBe(true)
    expect(status.tokenFingerprint).toContain('…')
    expect(JSON.stringify(status)).not.toContain(TOKEN)
  })

  it('awfSetSettings 持久化到 0600 文件并回显公开状态', async () => {
    const { root, stateDir, bridge } = await fixture({})
    const next = await bridge.setSettings({ baseUrl: 'http://awf.test' })
    expect(next.baseUrl).toBe('http://awf.test')
    const mode = (await stat(join(root, 'awf.json'))).mode & 0o777
    expect(mode).toBe(0o600)
    const raw = JSON.parse(await readFile(join(root, 'awf.json'), 'utf8')) as { apiToken?: string; baseUrl?: string }
    expect(raw.baseUrl).toBe('http://awf.test')
    expect(raw.apiToken).toBe('')
    void stateDir
  })

  it('awfSync：预检 → 推送 → 回执，请求携带 Bearer 与可见性', async () => {
    const { bridge, calls } = await fixture({
      'POST http://127.0.0.1:8000/api/sync/validate': [{ name: 'bridge-demo', ok: true, errors: [], conflict: null }],
      'POST http://127.0.0.1:8000/api/sync/workflows': [{ id: 5, name: 'bridge-demo', title: 'bridge-demo', status: 'draft', visibility: 'unlisted' }],
    })
    const receipt = await bridge.syncWorkflow({ name: 'bridge-demo', visibility: 'unlisted' })
    expect(receipt.ok).toBe(true)
    expect(receipt.stage).toBe('pushed')
    expect(receipt.workflow).toMatchObject({ id: 5, name: 'bridge-demo', visibility: 'unlisted' })
    expect(calls[0]?.url).toContain('/api/sync/validate')
    expect(calls[1]?.url).toContain('/api/sync/workflows')
    expect(calls[1]?.auth).toBe(`Bearer ${TOKEN}`)
    expect(calls[0]?.body).toMatchObject({ workflows: [{ name: 'bridge-demo', visibility: 'unlisted' }] })
  })

  it('awfSync 预检冲突 → stage=preflight 且不推送', async () => {
    const { bridge, calls } = await fixture({
      'POST http://127.0.0.1:8000/api/sync/validate': [
        { name: 'bridge-demo', ok: false, errors: [], conflict: '工作流已发布冻结，请先「新建版本」再编辑' },
      ],
    })
    const receipt = await bridge.syncWorkflow({ name: 'bridge-demo' })
    expect(receipt.ok).toBe(false)
    expect(receipt.stage).toBe('preflight')
    expect(receipt.validation?.conflict).toContain('冻结')
    expect(calls.filter((c) => c.url.includes('/api/sync/workflows') && c.method === 'POST')).toHaveLength(0)
  })

  it('awfSync 本地工作流不存在 → not-found 回执', async () => {
    const { bridge } = await fixture({})
    const receipt = await bridge.syncWorkflow({ name: 'ghost' })
    expect(receipt.ok).toBe(false)
    expect(receipt.errorKind).toBe('not-found')
  })

  it('checkConnection 失败分类（鉴权）', async () => {
    const { bridge } = await fixture(
      { 'GET http://127.0.0.1:8000/api/auth/me': { detail: 'token 无效' } },
      401,
    )
    const result = await bridge.checkConnection()
    expect(result.ok).toBe(false)
    expect(result.errorKind).toBe('auth')
  })

  it('executeDesktopWorkflowOp 分发 awf* 四个 op', async () => {
    const { plugin, bridge } = await fixture({
      'GET http://127.0.0.1:8000/api/auth/me': { email: 'u@test.local' },
      'POST http://127.0.0.1:8000/api/sync/validate': [{ name: 'bridge-demo', ok: true, errors: [], conflict: null }],
      'POST http://127.0.0.1:8000/api/sync/workflows': [{ id: 9, name: 'bridge-demo', title: 't', status: 'draft', visibility: 'private' }],
    })
    const extras = { awf: bridge }
    const status = await executeDesktopWorkflowOp(plugin, { op: 'awfGetSettings' }, undefined, extras)
    expect(status).toMatchObject({ hasToken: true })
    const saved = await executeDesktopWorkflowOp(
      plugin,
      { op: 'awfSetSettings', awfSettings: { apiTokenEnv: 'AWF_API_TOKEN' } },
      undefined,
      extras,
    )
    expect(saved).toMatchObject({ apiTokenEnv: 'AWF_API_TOKEN' })
    const receipt = await executeDesktopWorkflowOp(
      plugin,
      { op: 'awfSync', name: 'bridge-demo', awfVisibility: 'private' },
      undefined,
      extras,
    )
    expect(receipt).toMatchObject({ ok: true, stage: 'pushed' })
    await expect(
      executeDesktopWorkflowOp(plugin, { op: 'awfCheckConnection' }, undefined, extras),
    ).resolves.toMatchObject({ ok: true, email: 'u@test.local' })
  })

  it('awf* op 无 bridge 时显式报错（不静默）', async () => {
    const { plugin } = await fixture({})
    await expect(executeDesktopWorkflowOp(plugin, { op: 'awfGetSettings' })).rejects.toThrow(/AWF connector unavailable/)
    await expect(executeDesktopWorkflowOp(plugin, { op: 'awfSync', name: 'x' })).rejects.toThrow(/AWF connector unavailable/)
  })
})
