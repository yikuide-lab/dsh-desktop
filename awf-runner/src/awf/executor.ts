/**
 * Shared AWF executor loop (register → claim → execute → result, + heartbeat).
 *
 * Canonical pure-Node home of the executor claim/register machinery. Both the
 * desktop plugin (adapter with Host agent services) and the headless awf-node
 * runner consume this module. Task execution itself is injected as a callback
 * so each host decides how a claimed task runs (Host agents vs local engine).
 *
 * Credentials: the executor token is persisted 0600 next to awf.json and is
 * only ever sent as a Bearer header — never logged, never echoed.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AwfFetch } from './client.js'
import type { AwfSettings } from './settings.js'
import { readAwfSettings, resolveAwfToken } from './settings.js'

/** A task claimed from the platform queue (POST /api/executors/claim). */
export interface AwfClaimedTask {
  readonly id: number
  readonly workflow_name: string
  readonly step_id: string
  readonly payload: Record<string, unknown>
  readonly deadline_at: string | null
}

/** Result posted back to POST /api/executors/tasks/:id/result. */
export interface AwfTaskResult {
  ok: boolean
  output?: string
  error?: string
}

export interface AwfExecutorLoopOptions {
  readonly stateDir: string
  /** Executes one claimed task; must resolve (not throw) with an honest result. */
  readonly runTask: (task: AwfClaimedTask, signal: AbortSignal) => Promise<AwfTaskResult>
  readonly log?: (message: string) => void
  /** Test seams: inject fetch / env without touching globals. */
  readonly fetchImpl?: AwfFetch
  readonly env?: Record<string, string | undefined>
  readonly heartbeatMs?: number
  readonly claimIntervalMs?: number
  /**
   * Long-poll budget passed as ?wait_sec= to POST /api/executors/claim
   * (platform supports 0..30). 0 disables long-polling (classic poll cadence).
   */
  readonly claimWaitSec?: number
  /** Max tasks executed concurrently (1..32). 1 keeps strict sequential order. */
  readonly concurrency?: number
  /** Executor name sent at registration. */
  readonly registerName?: string
  /** Capability flags sent at registration. */
  readonly capabilities?: Record<string, unknown>
  /** Flat string labels sent at registration (queue routing). */
  readonly labels?: Record<string, string>
  /** Gate for start() (e.g. settings.executorEnabled on desktop). Default: always on. */
  readonly isEnabled?: () => Promise<boolean>
  /**
   * Resolve the platform user JWT used for one-time executor registration.
   * Default: env-var > saved-token chain from settings.
   */
  readonly resolveUserToken?: (settings: AwfSettings) => Promise<string | null>
}

export interface AwfExecutorLoopStatus {
  readonly running: boolean
  readonly registered: boolean
  readonly executorId: number | null
  /** First in-flight task id (compat with the desktop status view). */
  readonly executingTaskId: number | null
  /** Number of tasks currently executing. */
  readonly executingCount: number
  readonly lastClaimAt: string | null
  readonly lastError: string | null
}

export interface AwfExecutorLoopController {
  start(): void
  stop(): Promise<void>
  status(): AwfExecutorLoopStatus
}

/** 执行器凭据文件（0600，与 awf.json 同目录）；token 只落盘、不回显。 */
export function awfExecutorCredentialsPath(stateDir: string): string {
  return join(stateDir, '..', 'awf-executor.json')
}

function clampConcurrency(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.min(Math.max(Math.floor(value), 1), 32)
}

export function createAwfExecutorLoop(options: AwfExecutorLoopOptions): AwfExecutorLoopController {
  const log = options.log ?? ((): void => {})
  const doFetch = options.fetchImpl ?? fetch
  const heartbeatMs = options.heartbeatMs ?? 30_000
  const claimIntervalMs = options.claimIntervalMs ?? 3_000
  const claimWaitSec = Math.min(Math.max(Math.floor(options.claimWaitSec ?? 0), 0), 30)
  const concurrency = clampConcurrency(options.concurrency)
  const base = { value: '' }
  const state = {
    running: false,
    registered: false,
    executorId: null as number | null,
    lastClaimAt: null as string | null,
    lastError: null as string | null,
    stopped: false,
  }
  const inFlight = new Map<number, AbortController>()
  let loopTimer: ReturnType<typeof setTimeout> | null = null

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
    if (!response.ok) {
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
    const userToken = options.resolveUserToken
      ? await options.resolveUserToken(settings)
      : resolveAwfToken(settings, options.env) || null
    if (!userToken) throw new Error('缺少平台用户凭据（先配置 AWF 连接或登录）')
    await baseUrl()
    const registration: Record<string, unknown> = {
      name: options.registerName ?? 'awf-node',
      capabilities: options.capabilities ?? { task: true },
    }
    if (options.concurrency !== undefined) registration.concurrency = clampConcurrency(options.concurrency)
    if (options.labels && Object.keys(options.labels).length > 0) registration.labels = options.labels
    const { body } = await request('/api/executors/register', {
      method: 'POST',
      body: JSON.stringify(registration),
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

  async function executeTask(token: string, task: AwfClaimedTask): Promise<void> {
    const controller = new AbortController()
    inFlight.set(task.id, controller)
    let result: AwfTaskResult
    try {
      result = await options.runTask(task, controller.signal)
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      inFlight.delete(task.id)
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
      if (inFlight.size >= concurrency) {
        schedule(claimIntervalMs)
        return
      }
      const path = claimWaitSec > 0
        ? `/api/executors/claim?wait_sec=${claimWaitSec}`
        : '/api/executors/claim'
      const { body } = await request(path, {
        method: 'POST',
        ...(claimWaitSec > 0 ? { signal: AbortSignal.timeout((claimWaitSec + 15) * 1000) } : {}),
      }, credentials.token)
      const task = (body.task ?? null) as AwfClaimedTask | null
      if (task) {
        state.lastClaimAt = new Date().toISOString()
        if (concurrency > 1) {
          void executeTask(credentials.token, task)
        } else {
          await executeTask(credentials.token, task)
        }
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
        if (options.isEnabled && !(await options.isEnabled())) {
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
      for (const controller of inFlight.values()) controller.abort()
    },
    status() {
      return {
        running: state.running,
        registered: state.registered,
        executorId: state.executorId,
        executingTaskId: inFlight.keys().next().value ?? null,
        executingCount: inFlight.size,
        lastClaimAt: state.lastClaimAt,
        lastError: state.lastError,
      }
    },
  }
}
