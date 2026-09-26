/**
 * Minimal REST client for the AWF platform (workflow-wise twin of this plugin).
 *
 * Canonical pure-Node home of the AWF client (shared by the desktop plugins
 * and the headless awf-node runner). Error surfaces are classified for UI
 * handling: network / auth / validation / conflict / not-found / server.
 * Token comes from settings resolution (see ./settings.js) and is only ever
 * sent as a Bearer header — never logged, never embedded in URLs or payloads.
 */
import type { AwfSettings } from './settings.js';
export type AwfErrorKind = 'network' | 'auth' | 'validation' | 'conflict' | 'not-found' | 'server';
export declare class AwfError extends Error {
    readonly kind: AwfErrorKind;
    readonly status: number | null;
    readonly detail: unknown;
    constructor(kind: AwfErrorKind, message: string, status?: number | null, detail?: unknown);
}
export interface AwfSyncItem {
    readonly name: string;
    readonly yaml_text: string;
    readonly title?: string;
    readonly description?: string;
    readonly version?: string;
    readonly visibility?: 'private' | 'unlisted' | 'public';
}
export interface AwfValidateResult {
    readonly name: string;
    readonly ok: boolean;
    /** Platform may return string messages or structured {path,code,msg}. */
    readonly errors: ReadonlyArray<string | {
        path: string;
        code: string;
        msg: string;
    }>;
    readonly warnings?: readonly string[];
    readonly conflict: string | null;
}
export interface AwfWorkflowSummary {
    readonly id: number;
    readonly name: string;
    readonly title: string;
    readonly status: string;
    readonly visibility: string;
    readonly updated_at?: string;
}
export interface AwfCapabilities {
    readonly dsl_version: string;
    readonly base_step_types: string[];
    readonly platform_extension_types: string[];
    readonly features: {
        gate: boolean;
        sub_workflow: boolean;
        compensation: boolean;
    };
}
export interface AwfRunGate {
    readonly step_id?: string;
    readonly token: string;
    readonly resolved?: boolean;
    readonly question?: string;
    readonly options?: readonly string[];
}
export interface AwfRun {
    readonly id: number;
    /** Runner UUID; CreateRun also returns as run_id. Prefer for poll + resolveGate. */
    readonly runner_run_id: string;
    /** Alias of runner_run_id when present on CreateRun / GetRun responses. */
    readonly run_id?: string;
    readonly status: string;
    readonly result_text?: string;
    readonly error_text?: string;
    readonly auto_approve?: boolean;
    readonly external_loop_id?: string | null;
    readonly external_branch_id?: string | null;
    readonly gates?: readonly AwfRunGate[];
}
export type AwfFetch = typeof fetch;
export interface AwfCreateRunOptions {
    readonly autoApprove?: boolean;
    readonly externalLoopId?: string;
    readonly externalBranchId?: string;
}
export interface AwfClient {
    checkConnection(): Promise<{
        ok: boolean;
        email: string | null;
    }>;
    capabilities(): Promise<AwfCapabilities>;
    syncValidate(items: readonly AwfSyncItem[]): Promise<readonly AwfValidateResult[]>;
    syncPush(items: readonly AwfSyncItem[]): Promise<readonly AwfWorkflowSummary[]>;
    syncPull(): Promise<readonly AwfWorkflowSummary[]>;
    createRun(workflowId: number, params: Record<string, string>, options?: AwfCreateRunOptions): Promise<AwfRun>;
    listRuns(workflowId: number): Promise<readonly AwfRun[]>;
    /** GET single run by runner UUID or run_records numeric id (AWF A1). */
    getRun(runId: string | number): Promise<AwfRun>;
    /** Path run id: runner UUID preferred; numeric id still accepted for legacy. */
    resolveGate(runId: string | number, token: string, decision: string, options?: {
        delegateToken?: string;
    }): Promise<AwfRun>;
    /**
     * A4: mint short-lived gate_delegate JWT (owner access token required).
     * Host may resolveGate with `delegateToken` without holding user access JWT.
     */
    createGateDelegate(runId: string | number, options?: {
        gateToken?: string;
        ttlSeconds?: number;
    }): Promise<{
        delegate_token: string;
        expires_at: string;
        run_id: string;
        ttl_seconds: number;
        gate_token?: string;
    }>;
    publish(workflowId: number, note?: string): Promise<AwfWorkflowSummary>;
    /** 摘要级遥测上报（C-P4）：只含名称/状态/步骤状态/token 估算/耗时。 */
    telemetryRun(summary: AwfTelemetrySummary): Promise<{
        ok: boolean;
        id: number;
    }>;
}
/** 摘要级遥测载荷；契约上禁止 prompt / 输出内容字段。 */
export interface AwfTelemetrySummary {
    readonly client: 'desktop';
    readonly workflow_name: string;
    readonly run_ref: string;
    readonly status: string;
    readonly steps: ReadonlyArray<{
        id: string;
        type: string;
        status: string;
    }>;
    readonly token_estimate?: number;
    readonly duration_ms?: number;
    readonly finished_at?: string;
    readonly external_loop_id?: string;
    readonly external_branch_id?: string;
}
export declare function createAwfClient(settings: AwfSettings, options?: {
    fetchImpl?: AwfFetch;
    env?: Record<string, string | undefined>;
    token?: string;
    /** 每次请求前动态解析 Bearer（登录会话 access token）；优先于静态 token。 */
    tokenProvider?: () => Promise<string | null>;
    /** 401 时的补救路径（如刷新会话）；返回新 token 则重试一次，返回 null 则照常抛错。 */
    onAuthFailure?: () => Promise<string | null>;
}): AwfClient;
//# sourceMappingURL=client.d.ts.map