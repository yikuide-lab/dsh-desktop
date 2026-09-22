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
    readonly errors: Array<{
        path: string;
        code: string;
        msg: string;
    }>;
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
export interface AwfRun {
    readonly id: number;
    readonly runner_run_id: string;
    readonly status: string;
    readonly result_text?: string;
    readonly error_text?: string;
    readonly gates?: Array<{
        step_id: string;
        token: string;
        resolved: boolean;
    }>;
}
export type AwfFetch = typeof fetch;
export interface AwfClient {
    checkConnection(): Promise<{
        ok: boolean;
        email: string | null;
    }>;
    capabilities(): Promise<AwfCapabilities>;
    syncValidate(items: readonly AwfSyncItem[]): Promise<readonly AwfValidateResult[]>;
    syncPush(items: readonly AwfSyncItem[]): Promise<readonly AwfWorkflowSummary[]>;
    syncPull(): Promise<readonly AwfWorkflowSummary[]>;
    createRun(workflowId: number, params: Record<string, string>, options?: {
        autoApprove?: boolean;
    }): Promise<AwfRun>;
    listRuns(workflowId: number): Promise<readonly AwfRun[]>;
    resolveGate(runDbId: number, token: string, decision: string): Promise<AwfRun>;
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