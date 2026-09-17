/**
 * Opt-in desktop executor for the AWF platform (awf-a3c S-P4 PoC).
 *
 * Registers once with the user JWT (token resolved from settings/env), stores
 * the executor token in a 0600 file, then runs a heartbeat → claim → execute
 * → return loop. Claimed `task (executor=desktop)` steps execute through the
 * Host's real agent task path when available; without the agents service the
 * task fails honestly instead of pretending. Loop cadence is PoC-grade and the
 * whole feature is off until explicitly enabled in settings.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ExecutionContext, Step, Workflow } from 'dsh-plugin-workflow/engine'
import type { AwfFetch } from './desktop-awf-client.ts'
import { readAwfSettings, resolveAwfToken } from './desktop-awf-settings.ts'
import type { DesktopWorkflowHostServices } from './desktop-workflow-executor.ts'

export interface AwfExecutorOptions {
  readonly stateDir: string
  readonly log?: (message: string) => void
  /** Test seams: inject fetch / env without touching globals. */
  readonly fetchImpl?: AwfFetch
  readonly env?: Record<string, string | undefined>
  /** Host LLM/agents services (available once the llm service is injected). */
  readonly getHostServices?: () => DesktopWorkflowHostServices | undefined
  readonly heartbeatMs?: number
  readonly claimIntervalMs?: number
}

export interface AwfExecutorStatus {
  readonly running: boolean
  readonly registered: boolean
  readonly executorId: number | null
  readonly executingTaskId: number | null
  readonly lastClaimAt: string | null
  readonly lastError: string | null
}

export interface AwfExecutorController {
  /** 启动心跳/认领循环（仅在 settings.executorEnabled=true 时生效）。 */
  start(): void
  stop(): Promise<void>
  status(): AwfExecutorStatus
}

/** 执行器凭据文件（0600，与 awf.json 同目录）；token 只落盘、不回显。 */
export function awfExecutorCredentialsPath(stateDir: string): string {
  return join(stateDir, '..', 'awf-executor.json')
}

export function createAwfExecutor(options: AwfExecutorOptions): AwfExecutorController {
  const log = options.log ?? ((): void => {})
  const doFetch = options.fetchImpl ?? fetch
  const heartbeatMs = options.heartbeatMs ?? 30_000
  const claimIntervalMs = options.claimIntervalMs ?? 3_000
  const base = { value: '' }
  const state = {
    running: false,
    registered: false,
    executorId: null as number | null,
    executingTaskId: null as number | null,
    lastClaimAt: null as string | null,
    lastError: null as string | null,
    stopped: false,
  }
  let loopTimer: ReturnType<typeof setTimeout> | null = null
  let inFlight: AbortController | null = null

  function credentialsPath(): string {
    return awfExecutorCredentialsPath(options.stateDir)
  }

  async function readCredentials(): Promise<{ executorId: number; token: string } | null> {
    try {
      const raw = await readFile(credentialsPath(), 'utf8')
      const parsed = JSON.parse(raw) as { executorId?: number; token?: string }
      if (typeof parsed.executorId === 'number' && typeof parsed.token === 'string' && parsed.token) {
        return { executorId: parsed.executorId, token: parsed.token }
      }
      return null
    } catch {
      return null
    }
  }

  async function writeCredentials(credentials: { executorId: number; token: string }): Promise<void> {
    const path = credentialsPath()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(credentials, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  }

  async function request(
    path: string,
    init: RequestInit,
    token: string,
    allow401 = false,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    let response: Response
    try {
      response = await doFetch(`${base.value}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...((init.headers as Record<string, string>) ?? {}),
        },
      })
    } catch (error) {
      throw new Error(`无法连接 AWF 平台（${base.value}）：${error instanceof Error ? error.message : String(error)}`)
    }
    const text = await response.text()
    let body: Record<string, unknown> = {}
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    } catch {
      body = {}
    }
    if (!response.ok && !(allow401 && response.status === 401)) {
      const detail = typeof body.detail === 'string' ? body.detail : `HTTP ${response.status}`
      throw new Error(detail)
    }
    return { status: response.status, body }
  }

  async function baseUrl(): Promise<string> {
    if (!base.value) {
      const settings = await readAwfSettings(options.stateDir)
      base.value = settings.baseUrl.replace(/\/+$/, '')
    }
    return base.value
  }

  async function ensureRegistered(): Promise<{ executorId: number; token: string }> {
    const saved = await readCredentials()
    if (saved) {
      try {
        await request('/api/executors/me', { method: 'GET' }, saved.token)
        state.registered = true
        state.executorId = saved.executorId
        return saved
      } catch {
        log('AWF executor: saved credentials rejected; re-registering')
      }
    }
    const settings = await readAwfSettings(options.stateDir)
    const userToken = resolveAwfToken(settings, options.env)
    if (!userToken) throw new Error('缺少平台用户凭据（先在设置中配置 AWF 连接）')
    await baseUrl()
    const { body } = await request('/api/executors/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'dsh-desktop', capabilities: { task: true } }),
    }, userToken)
    const executorId = typeof body.executor_id === 'number' ? body.executor_id : null
    const token = typeof body.token === 'string' ? body.token : null
    if (executorId === null || !token) throw new Error('执行器注册响应不完整')
    const credentials = { executorId, token }
    await writeCredentials(credentials)
    state.registered = true
    state.executorId = executorId
    log(`AWF executor: registered as #${executorId}`)
    return credentials
  }

  async function executeTask(
    token: string,
    task: { id: number; workflow_name: string; step_id: string; payload: Record<string, unknown>; deadline_at: string | null },
  ): Promise<void> {
    state.executingTaskId = task.id
    inFlight = new AbortController()
    const signal = inFlight.signal
    let result: { ok: boolean; output?: string; error?: string }
    try {
      const services = options.getHostServices?.()
      if (!services?.agents) {
        result = { ok: false, error: '桌面执行器不可用：缺少 Host agents 服务' }
      } else {
        const { runTaskStep } = await import('./desktop-workflow-executor.ts')
        const step = {
          id: task.step_id,
          type: 'task',
          prompt: typeof task.payload.prompt === 'string' ? task.payload.prompt : '',
          inputs: task.payload.inputs,
          outputs: Array.isArray(task.payload.outputs) ? task.payload.outputs : undefined,
          acceptance: Array.isArray(task.payload.acceptance) ? task.payload.acceptance : undefined,
          role: typeof task.payload.role === 'string' ? task.payload.role : undefined,
        } as unknown as Step
        const params = (task.payload.params && typeof task.payload.params === 'object'
          ? task.payload.params
          : {}) as Record<string, unknown>
        const cwd = typeof params.workspace === 'string' && params.workspace.trim()
          ? params.workspace.trim()
          : homedir()
        const context: ExecutionContext = {
          runId: `awf-task-${task.id}`,
          workflow: {
            apiVersion: 'workflow-wise/v1',
            kind: 'Workflow',
            metadata: { name: task.workflow_name },
            spec: { steps: [] },
          } as unknown as Workflow,
          stateDir: options.stateDir,
          params,
        }
        const outcome = await runTaskStep(services, step, context, cwd, signal)
        result = outcome.ok
          ? { ok: true, output: typeof outcome.output === 'string' ? outcome.output : JSON.stringify(outcome.output) }
          : { ok: false, error: outcome.error ?? 'executor task failed' }
      }
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      inFlight = null
      state.executingTaskId = null
    }
    try {
      await request(`/api/executors/tasks/${task.id}/result`, {
        method: 'POST',
        body: JSON.stringify(result),
      }, token)
      log(`AWF executor: task #${task.id} ${result.ok ? 'completed' : `failed: ${result.error ?? ''}`}`)
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error)
      log(`AWF executor: posting result for task #${task.id} failed: ${state.lastError}`)
    }
  }

  async function loop(): Promise<void> {
    try {
      const credentials = await ensureRegistered()
      await baseUrl()
      const { body } = await request('/api/executors/claim', { method: 'POST' }, credentials.token)
      const task = (body.task ?? null) as {
        id: number
        workflow_name: string
        step_id: string
        payload: Record<string, unknown>
        deadline_at: string | null
      } | null
      if (task) {
        state.lastClaimAt = new Date().toISOString()
        await executeTask(credentials.token, task)
        // 认领到任务后立即继续（队列可能还有积压）
        schedule(0)
        return
      }
      schedule(claimIntervalMs)
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error)
      log(`AWF executor: loop error: ${state.lastError}`)
      // 失败后退避重试（注册/网络问题多为瞬态）
      schedule(Math.max(claimIntervalMs * 5, 15_000))
    }
  }

  function schedule(delayMs: number): void {
    if (state.stopped) return
    loopTimer = setTimeout(() => {
      void loop()
    }, delayMs)
  }

  async function heartbeatLoop(): Promise<void> {
    while (!state.stopped) {
      await new Promise((resolve) => setTimeout(resolve, heartbeatMs))
      if (state.stopped) return
      try {
        const credentials = await readCredentials()
        if (credentials) {
          await request('/api/executors/heartbeat', { method: 'POST' }, credentials.token)
        }
      } catch {
        // 心跳失败不中断主循环；认领失败同样会暴露连接问题
      }
    }
  }

  return {
    start() {
      void (async () => {
        const settings = await readAwfSettings(options.stateDir)
        if (!settings.executorEnabled) {
          log('AWF executor: enabled=false; start ignored')
          return
        }
        if (state.running) return
        state.running = true
        state.stopped = false
        state.lastError = null
        void heartbeatLoop()
        schedule(0)
      })()
    },
    async stop() {
      state.stopped = true
      state.running = false
      if (loopTimer) {
        clearTimeout(loopTimer)
        loopTimer = null
      }
      inFlight?.abort()
      inFlight = null
    },
    status() {
      return {
        running: state.running,
        registered: state.registered,
        executorId: state.executorId,
        executingTaskId: state.executingTaskId,
        lastClaimAt: state.lastClaimAt,
        lastError: state.lastError,
      }
    },
  }
}
