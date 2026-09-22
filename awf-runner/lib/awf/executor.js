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
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readAwfSettings, resolveAwfToken } from './settings.js';
/** 执行器凭据文件（0600，与 awf.json 同目录）；token 只落盘、不回显。 */
export function awfExecutorCredentialsPath(stateDir) {
    return join(stateDir, '..', 'awf-executor.json');
}
function clampConcurrency(value) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return 1;
    return Math.min(Math.max(Math.floor(value), 1), 32);
}
export function createAwfExecutorLoop(options) {
    const log = options.log ?? (() => { });
    const doFetch = options.fetchImpl ?? fetch;
    const heartbeatMs = options.heartbeatMs ?? 30_000;
    const claimIntervalMs = options.claimIntervalMs ?? 3_000;
    const claimWaitSec = Math.min(Math.max(Math.floor(options.claimWaitSec ?? 0), 0), 30);
    const concurrency = clampConcurrency(options.concurrency);
    const base = { value: '' };
    const state = {
        running: false,
        registered: false,
        executorId: null,
        lastClaimAt: null,
        lastError: null,
        stopped: false,
    };
    const inFlight = new Map();
    let loopTimer = null;
    function credentialsPath() {
        return awfExecutorCredentialsPath(options.stateDir);
    }
    async function readCredentials() {
        try {
            const raw = await readFile(credentialsPath(), 'utf8');
            const parsed = JSON.parse(raw);
            if (typeof parsed.executorId === 'number' && typeof parsed.token === 'string' && parsed.token) {
                return { executorId: parsed.executorId, token: parsed.token };
            }
            return null;
        }
        catch {
            return null;
        }
    }
    async function writeCredentials(credentials) {
        const path = credentialsPath();
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, `${JSON.stringify(credentials, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    }
    async function request(path, init, token) {
        let response;
        try {
            response = await doFetch(`${base.value}${path}`, {
                ...init,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    ...(init.headers ?? {}),
                },
            });
        }
        catch (error) {
            throw new Error(`无法连接 AWF 平台（${base.value}）：${error instanceof Error ? error.message : String(error)}`);
        }
        const text = await response.text();
        let body = {};
        try {
            body = text ? JSON.parse(text) : {};
        }
        catch {
            body = {};
        }
        if (!response.ok) {
            const detail = typeof body.detail === 'string' ? body.detail : `HTTP ${response.status}`;
            throw new Error(detail);
        }
        return { status: response.status, body };
    }
    async function baseUrl() {
        if (!base.value) {
            const settings = await readAwfSettings(options.stateDir);
            base.value = settings.baseUrl.replace(/\/+$/, '');
        }
        return base.value;
    }
    async function ensureRegistered() {
        const saved = await readCredentials();
        if (saved) {
            try {
                await request('/api/executors/me', { method: 'GET' }, saved.token);
                state.registered = true;
                state.executorId = saved.executorId;
                return saved;
            }
            catch {
                log('AWF executor: saved credentials rejected; re-registering');
            }
        }
        const settings = await readAwfSettings(options.stateDir);
        const userToken = options.resolveUserToken
            ? await options.resolveUserToken(settings)
            : resolveAwfToken(settings, options.env) || null;
        if (!userToken)
            throw new Error('缺少平台用户凭据（先配置 AWF 连接或登录）');
        await baseUrl();
        const registration = {
            name: options.registerName ?? 'awf-node',
            capabilities: options.capabilities ?? { task: true },
        };
        if (options.concurrency !== undefined)
            registration.concurrency = clampConcurrency(options.concurrency);
        if (options.labels && Object.keys(options.labels).length > 0)
            registration.labels = options.labels;
        const { body } = await request('/api/executors/register', {
            method: 'POST',
            body: JSON.stringify(registration),
        }, userToken);
        const executorId = typeof body.executor_id === 'number' ? body.executor_id : null;
        const token = typeof body.token === 'string' ? body.token : null;
        if (executorId === null || !token)
            throw new Error('执行器注册响应不完整');
        const credentials = { executorId, token };
        await writeCredentials(credentials);
        state.registered = true;
        state.executorId = executorId;
        log(`AWF executor: registered as #${executorId}`);
        return credentials;
    }
    async function executeTask(token, task) {
        const controller = new AbortController();
        inFlight.set(task.id, controller);
        let result;
        try {
            result = await options.runTask(task, controller.signal);
        }
        catch (error) {
            result = { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
        finally {
            inFlight.delete(task.id);
        }
        try {
            await request(`/api/executors/tasks/${task.id}/result`, {
                method: 'POST',
                body: JSON.stringify(result),
            }, token);
            log(`AWF executor: task #${task.id} ${result.ok ? 'completed' : `failed: ${result.error ?? ''}`}`);
        }
        catch (error) {
            state.lastError = error instanceof Error ? error.message : String(error);
            log(`AWF executor: posting result for task #${task.id} failed: ${state.lastError}`);
        }
    }
    async function loop() {
        try {
            const credentials = await ensureRegistered();
            await baseUrl();
            if (inFlight.size >= concurrency) {
                schedule(claimIntervalMs);
                return;
            }
            const path = claimWaitSec > 0
                ? `/api/executors/claim?wait_sec=${claimWaitSec}`
                : '/api/executors/claim';
            const { body } = await request(path, {
                method: 'POST',
                ...(claimWaitSec > 0 ? { signal: AbortSignal.timeout((claimWaitSec + 15) * 1000) } : {}),
            }, credentials.token);
            const task = (body.task ?? null);
            if (task) {
                state.lastClaimAt = new Date().toISOString();
                if (concurrency > 1) {
                    void executeTask(credentials.token, task);
                }
                else {
                    await executeTask(credentials.token, task);
                }
                // 认领到任务后立即继续（队列可能还有积压）
                schedule(0);
                return;
            }
            schedule(claimIntervalMs);
        }
        catch (error) {
            state.lastError = error instanceof Error ? error.message : String(error);
            log(`AWF executor: loop error: ${state.lastError}`);
            // 失败后退避重试（注册/网络问题多为瞬态）
            schedule(Math.max(claimIntervalMs * 5, 15_000));
        }
    }
    function schedule(delayMs) {
        if (state.stopped)
            return;
        loopTimer = setTimeout(() => {
            void loop();
        }, delayMs);
    }
    async function heartbeatLoop() {
        while (!state.stopped) {
            await new Promise((resolve) => setTimeout(resolve, heartbeatMs));
            if (state.stopped)
                return;
            try {
                const credentials = await readCredentials();
                if (credentials) {
                    await request('/api/executors/heartbeat', { method: 'POST' }, credentials.token);
                }
            }
            catch {
                // 心跳失败不中断主循环；认领失败同样会暴露连接问题
            }
        }
    }
    return {
        start() {
            void (async () => {
                if (options.isEnabled && !(await options.isEnabled())) {
                    log('AWF executor: enabled=false; start ignored');
                    return;
                }
                if (state.running)
                    return;
                state.running = true;
                state.stopped = false;
                state.lastError = null;
                void heartbeatLoop();
                schedule(0);
            })();
        },
        async stop() {
            state.stopped = true;
            state.running = false;
            if (loopTimer) {
                clearTimeout(loopTimer);
                loopTimer = null;
            }
            for (const controller of inFlight.values())
                controller.abort();
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
            };
        },
    };
}
//# sourceMappingURL=executor.js.map