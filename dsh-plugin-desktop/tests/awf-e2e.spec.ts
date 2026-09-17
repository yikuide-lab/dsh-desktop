/**
 * 端到端联调（默认跳过）：设 AWF_E2E_BASE_URL 指向运行中的本地 AWF 平台后执行。
 *   AWF_E2E_BASE_URL=http://127.0.0.1:8902 corepack yarn vitest run tests/awf-e2e.spec.ts
 * 验证 desktop-awf-client 对真实平台的全闭环：capabilities → 预检 → 推送 → 拉取 → 远程运行。
 * 安全约束：目标仅允许环回/localhost 的 http(s)（联调只打本地服务）；
 * 凭据用 crypto 随机生成，不落任何字面量。
 */
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createAwfClient } from '../src/desktop-awf-client.ts'
import { defaultAwfSettings } from '../src/desktop-awf-settings.ts'

function e2eTarget(): string | null {
  const raw = process.env.AWF_E2E_BASE_URL
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase()
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return null
  return raw.replace(/\/+$/, '')
}

const BASE = e2eTarget()
const d = BASE ? describe : describe.skip

const RUN = randomBytes(5).toString('hex')
const EMAIL = `dsh-e2e-${RUN}@test.local`
const PASSWORD = `e2e-${randomBytes(12).toString('base64url')}`

const YAML = `apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: dsh-e2e-${RUN}
spec:
  steps:
    - id: say
      type: script
      run: echo e2e-from-dsh
`

function client(token: string) {
  return createAwfClient({ ...defaultAwfSettings(), baseUrl: BASE! }, { token })
}

d('awf client against a live platform', () => {
  let token = ''
  let workflowId = 0

  it('registers a user and connects', async () => {
    const reg = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    })
    expect(reg.status).toBe(200)
    token = (await reg.json()).access_token
    expect(token).toBeTruthy()

    const conn = await client(token).checkConnection()
    expect(conn.ok).toBe(true)
    expect(conn.email).toBe(EMAIL)
  })

  it('capabilities matches the platform contract', async () => {
    const caps = await client(token).capabilities()
    expect(caps.dsl_version).toBe('workflow-wise/v1')
    expect(caps.base_step_types).toContain('sub_workflow')
    expect(caps.features.sub_workflow).toBe(true)
  })

  it('preflight → push → pull round-trip', async () => {
    const item = { name: `dsh-e2e-${RUN}`, yaml_text: YAML }
    const pre = await client(token).syncValidate([item])
    expect(pre[0]?.ok).toBe(true)

    const pushed = await client(token).syncPush([item])
    expect(pushed[0]?.name).toBe(`dsh-e2e-${RUN}`)
    workflowId = pushed[0]?.id ?? 0
    expect(workflowId).toBeGreaterThan(0)

    const pulled = await client(token).syncPull()
    expect(pulled.some((w) => w.id === workflowId)).toBe(true)
  })

  it('remote run executes and completes', async () => {
    const run = await client(token).createRun(workflowId, {})
    expect(['completed', 'running']).toContain(run.status)
    if (run.status === 'completed') {
      expect(run.result_text).toContain('e2e-from-dsh')
      return
    }
    // 同步窗口外 handoff：轮询到完成
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 300))
      const found = (await client(token).listRuns(workflowId)).find((x) => x.id === run.id)
      if (found?.status === 'completed') {
        expect(found.result_text).toContain('e2e-from-dsh')
        return
      }
      expect(found?.status).not.toBe('failed')
    }
    throw new Error('run 未在轮询窗口内完成')
  })
})
