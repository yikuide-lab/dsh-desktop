/**
 * Persisted settings for the optional AWF platform connector.
 *
 * Canonical pure-Node home of the AWF settings module (shared by the desktop
 * plugins and the headless awf-node runner). 0600 JSON beside the state dir,
 * raw tokens never echoed to callers (fingerprint only). Token resolution
 * prefers the configured environment variable; an explicitly saved token is
 * the fallback. No credential literals live in source, examples, or tests.
 */
export declare const AWF_DEFAULT_BASE_URL = "https://awf.seedwill.com";
export declare const AWF_DEFAULT_TOKEN_ENV = "AWF_API_TOKEN";
export interface AwfSettings {
    /** Platform base URL, e.g. https://awf.seedwill.com */
    readonly baseUrl: string;
    /** Environment variable consulted for the API token (env wins over saved token). */
    readonly apiTokenEnv: string;
    /** Token saved through the UI; empty when the env var is the source. */
    readonly apiToken: string;
    /**
     * 遥测上报（awf-a3c C-P4 通道⑤，默认关）：开启后本地 run 结束才上报摘要
     * （工作流名/步骤状态/token 估算/耗时，绝不含 prompt 与输出内容）。
     */
    readonly telemetryEnabled: boolean;
    /** 桌面执行器（awf-a3c S-P4 PoC，默认关）：认领平台 task(executor=desktop) 并本地执行。 */
    readonly executorEnabled: boolean;
    /** 反向隧道（awf-hbw Phase 3b，默认关）：建立到平台的 WebSocket 长连接并在本地暴露 OpenAI 兼容端口。 */
    readonly tunnelEnabled: boolean;
    readonly tunnelLocalPort: number;
}
export interface AwfPublicSettings {
    readonly baseUrl: string;
    readonly apiTokenEnv: string;
    readonly hasToken: boolean;
    /** Fingerprint like `abcd…wxyz`; empty when no token is configured. */
    readonly tokenFingerprint: string;
    readonly telemetryEnabled: boolean;
    readonly executorEnabled: boolean;
    readonly tunnelEnabled: boolean;
}
export declare function defaultAwfSettings(): AwfSettings;
export declare function awfSettingsPath(stateDir: string): string;
export declare function normalizeAwfBaseUrl(raw: unknown): string;
export declare function normalizeAwfSettings(raw: Partial<AwfSettings> | undefined): AwfSettings;
export declare function tokenFingerprint(token: string): string;
/** Env var wins over an explicitly saved token. */
export declare function resolveAwfToken(settings: AwfSettings, env?: Record<string, string | undefined>): string;
export declare function toPublicAwfSettings(settings: AwfSettings, token: string): AwfPublicSettings;
export declare function readAwfSettings(stateDir: string): Promise<AwfSettings>;
export declare function writeAwfSettings(stateDir: string, settings: AwfSettings): Promise<AwfSettings>;
//# sourceMappingURL=settings.d.ts.map