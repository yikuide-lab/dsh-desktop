/**
 * awf-0bx golden parity：同一基础类型 YAML 在本地引擎与 AWF 平台执行，输出语义一致。
 *
 * 本地部分始终真实执行；平台部分仅在 AWF_E2E_BASE_URL 指向本机平台时联测，
 * 否则跳过（与 awf-e2e 同一守卫约定）。
 */
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WorkflowPlugin } from 'dsh-plugin-workflow'
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
const ECHO_TOKEN = `golden-${randomBytes(4).toString('hex')}`

const GOLDEN = `apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: golden-parity-${RUN}
spec:
  steps:
    - id: say
      type: script
      run: echo ${ECHO_TOKEN}
`

d('golden parity: local engine vs AWF platform (awf-0bx)', () => {
  it('both sides execute the same echo workflow with equivalent output', async () => {
    // 本地引擎真实执行
    const dir = await mkdtemp(join(tmpdir(), 'awf-parity-'))
    try {
      const plugin = new WorkflowPlugin({ stateDir: dir })
      await plugin.init()
      await plugin.createWorkflow(GOLDEN)
      const localRun = await plugin.startRun(`golden-parity-${RUN}`, {})
      // 本地引擎无 resultText 聚合字段：轮询到完成后从 tasks.result 收集输出
      let localText = ''
      for (let i = 0; i < 100; i++) {
        const run = await plugin.getRun(localRun.id)
        if (run?.status === 'completed' || run?.status === 'failed') {
          localText = Object.values(run.tasks)
            .map((task) => (typeof task.result === 'string' ? task.result : JSON.stringify(task.result ?? '')))
            .join('\n')
          break
        }
        expect(run?.status).not.toBe('failed')
        await new Promise((r) => setTimeout(r, 200))
      }
      expect(localText).toContain(ECHO_TOKEN)

      // 平台侧真实执行（注册→同步→发布→远程运行）
      const reg = await fetch(`${BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `parity-${RUN}@test.local`,
          password: `parity-${randomBytes(12).toString('base64url')}`,
        }),
      })
      expect(reg.status).toBe(200)
      const token = (await reg.json()).access_token
      const client = createAwfClient({ ...defaultAwfSettings(), baseUrl: BASE! }, { token })
      const pushed = await client.syncPush([{ name: `golden-parity-${RUN}`, yaml_text: GOLDEN }])
      const wfId = pushed[0]?.id ?? 0
      expect(wfId).toBeGreaterThan(0)
      await client.publish(wfId)
      const run = await client.createRun(wfId, {})
      expect(['completed', 'running']).toContain(run.status)
      expect(run.result_text ?? '').toContain(ECHO_TOKEN)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
