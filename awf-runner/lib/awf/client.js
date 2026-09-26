/**
 * Minimal REST client for the AWF platform (workflow-wise twin of this plugin).
 *
 * Canonical pure-Node home of the AWF client (shared by the desktop plugins
 * and the headless awf-node runner). Error surfaces are classified for UI
 * handling: network / auth / validation / conflict / not-found / server.
 * Token comes from settings resolution (see ./settings.js) and is only ever
 * sent as a Bearer header — never logged, never embedded in URLs or payloads.
 */
import { resolveAwfToken } from './settings.js';
export class AwfError extends Error {
    kind;
    status;
    detail;
    constructor(kind, message, status = null, detail = undefined) {
        super(message);
        this.name = 'AwfError';
        this.kind = kind;
        this.status = status;
        this.detail = detail;
    }
}
/** Normalize CreateRun/GetRun shapes: platform may return run_id without runner_run_id. */
function normalizeAwfRun(run) {
    const runner = run.runner_run_id || run.run_id || '';
    if (!runner)
        return run;
    return {
        ...run,
        runner_run_id: runner,
        run_id: run.run_id || runner,
    };
}
export function createAwfClient(settings, options = {}) {
    const doFetch = options.fetchImpl ?? fetch;
    const token = options.token ?? resolveAwfToken(settings, options.env);
    const base = settings.baseUrl.replace(/\/+$/, '');
    async function resolveBearer() {
        if (options.tokenProvider) {
            const provided = await options.tokenProvider();
            if (provided)
                return provided;
        }
        return token || null;
    }
    async function request(path, init = {}, authenticated = true, allowAuthRetry = true, overrideToken = null) {
        const headers = {
            'Content-Type': 'application/json',
            ...(init.headers ?? {}),
        };
        if (authenticated) {
            const bearer = overrideToken ?? (await resolveBearer());
            if (bearer)
                headers.Authorization = `Bearer ${bearer}`;
        }
        let response;
        try {
            response = await doFetch(`${base}${path}`, { ...init, headers });
        }
        catch (error) {
            throw new AwfError('network', `无法连接 AWF 平台（${base}）`, null, error);
        }
        // 会话 access token 过期 → onAuthFailure（刷新）拿到新 token 后带新凭据重试一次
        if (response.status === 401 && authenticated && allowAuthRetry && options.onAuthFailure) {
            const fresh = await options.onAuthFailure();
            if (fresh) {
                return request(path, init, authenticated, false, fresh);
            }
        }
        if (response.ok) {
            const text = await response.text();
            return (text ? JSON.parse(text) : null);
        }
        let detail = null;
        try {
            detail = await response.json();
        }
        catch {
            detail = null;
        }
        const messageFromDetail = (d) => {
            if (d && typeof d === 'object' && 'detail' in d) {
                const inner = d.detail;
                if (typeof inner === 'string')
                    return inner;
                if (inner && typeof inner === 'object' && 'message' in inner) {
                    return String(inner.message);
                }
                return JSON.stringify(inner);
            }
            return `HTTP ${response.status}`;
        };
        const message = messageFromDetail(detail);
        switch (response.status) {
            case 401:
            case 403:
                throw new AwfError('auth', `AWF 鉴权失败：${message}`, response.status, detail);
            case 400:
            case 422:
                throw new AwfError('validation', message, response.status, detail);
            case 404:
                throw new AwfError('not-found', message, response.status, detail);
            case 409:
                throw new AwfError('conflict', message, response.status, detail);
            default:
                throw new AwfError('server', message, response.status, detail);
        }
    }
    return {
        async checkConnection() {
            await request('/health', {}, false);
            const me = await request('/api/auth/me').catch((error) => {
                if (error.kind === 'not-found')
                    return null;
                throw error;
            });
            return { ok: true, email: me?.email ?? null };
        },
        capabilities() {
            return request('/api/dsl/capabilities', {}, false);
        },
        syncValidate(items) {
            return request('/api/sync/validate', {
                method: 'POST',
                body: JSON.stringify({ workflows: items }),
            });
        },
        syncPush(items) {
            return request('/api/sync/workflows', {
                method: 'POST',
                body: JSON.stringify({ workflows: items }),
            });
        },
        syncPull() {
            return request('/api/sync/workflows');
        },
        createRun(workflowId, params, options = {}) {
            // 默认 auto_approve=false：与本地引擎对齐（审批门等待人工 resolve），双跑语义一致
            const body = {
                params,
                auto_approve: options.autoApprove ?? false,
            };
            if (options.externalLoopId)
                body.external_loop_id = options.externalLoopId;
            if (options.externalBranchId)
                body.external_branch_id = options.externalBranchId;
            return request(`/api/workflows/${workflowId}/runs`, {
                method: 'POST',
                body: JSON.stringify(body),
            }).then(normalizeAwfRun);
        },
        listRuns(workflowId) {
            return request(`/api/workflows/${workflowId}/runs`).then((rows) => rows.map(normalizeAwfRun));
        },
        getRun(runId) {
            return request(`/api/workflows/runs/${encodeURIComponent(String(runId))}`).then(normalizeAwfRun);
        },
        createGateDelegate(runId, options = {}) {
            const body = {};
            if (options.gateToken)
                body.gate_token = options.gateToken;
            if (options.ttlSeconds != null)
                body.ttl_seconds = options.ttlSeconds;
            return request(`/api/workflows/runs/${encodeURIComponent(String(runId))}/gate-delegates`, {
                method: 'POST',
                body: JSON.stringify(body),
            });
        },
        resolveGate(runId, gateToken, decision, options = {}) {
            // 路径段编码：防 token 中保留字符（/ ? # 等）改变路径语义；runId 可为 runner UUID
            // A4：delegateToken 作 Bearer，跳过 access 刷新重试（delegate 单次有效）
            const delegate = options.delegateToken?.trim() || null;
            return request(`/api/workflows/runs/${encodeURIComponent(String(runId))}/gates/${encodeURIComponent(gateToken)}`, {
                method: 'POST',
                body: JSON.stringify({ decision }),
            }, true, !delegate, delegate).then(normalizeAwfRun);
        },
        publish(workflowId, note = 'dsh sync') {
            return request(`/api/workflows/${workflowId}/publish`, {
                method: 'POST',
                body: JSON.stringify({ note }),
            });
        },
        telemetryRun(summary) {
            return request('/api/telemetry/runs', {
                method: 'POST',
                body: JSON.stringify(summary),
            });
        },
    };
}
//# sourceMappingURL=client.js.map