#!/usr/bin/env node
/**
 * awf-node — headless AWF platform node runner.
 *
 *   awf-node serve --platform <baseUrl> [--token-env NAME] [--concurrency N]
 *                  [--labels k=v,...] [--state-dir DIR] [--claim-wait-sec N]
 *   awf-node login    --platform <baseUrl> --email <email> [--password <pw>]
 *   awf-node register --platform <baseUrl> --email <email> [--password <pw>] [--display-name <name>]
 *   awf-node status [--state-dir DIR]
 *
 * Env fallbacks: AWF_PLATFORM_URL (--platform), AWF_NODE_STATE_DIR
 * (--state-dir), AWF_NODE_PASSWORD (--password), AWF_API_TOKEN (default
 * --token-env), AWF_NODE_LLM_BASE_URL / AWF_NODE_LLM_API_KEY /
 * AWF_NODE_LLM_MODEL (llm/task step endpoint).
 */
export declare class CliUsageError extends Error {
}
export interface ServeCliOptions {
    readonly command: 'serve';
    readonly stateDir: string;
    readonly platform?: string;
    readonly tokenEnv?: string;
    readonly concurrency?: number;
    readonly labels?: Record<string, string>;
    readonly claimWaitSec?: number;
}
export interface AuthCliOptions {
    readonly command: 'login' | 'register';
    readonly stateDir: string;
    readonly platform?: string;
    readonly email: string;
    readonly password: string;
    readonly displayName?: string;
}
export interface StatusCliOptions {
    readonly command: 'status';
    readonly stateDir: string;
}
export interface TunnelCliOptions {
    readonly command: 'tunnel';
    readonly stateDir: string;
    readonly platform?: string;
    readonly port?: number;
    readonly target?: string;
}
export interface HelpCliOptions {
    readonly command: 'help';
}
export type CliCommand = ServeCliOptions | AuthCliOptions | StatusCliOptions | TunnelCliOptions | HelpCliOptions;
export declare function parseLabels(raw: string): Record<string, string>;
export declare function parseConcurrency(raw: string): number;
export declare function parseClaimWaitSec(raw: string): number;
/** Parse argv (already stripped of node/script). Throws CliUsageError. */
export declare function parseCliArgs(argv: readonly string[], env?: Record<string, string | undefined>): CliCommand;
export declare const CLI_USAGE = "awf-node \u2014 headless AWF platform node runner\n\nUsage:\n  awf-node serve --platform <baseUrl> [--token-env NAME] [--concurrency N]\n                 [--labels k=v,...] [--state-dir DIR] [--claim-wait-sec N]\n  awf-node tunnel --platform <baseUrl> [--port N] [--target URL] [--state-dir DIR]\n  awf-node login    --platform <baseUrl> --email <email> [--password <pw>]\n  awf-node register --platform <baseUrl> --email <email> [--password <pw>] [--display-name <name>]\n  awf-node status [--state-dir DIR]\n\nEnvironment:\n  AWF_PLATFORM_URL        default for --platform\n  AWF_NODE_STATE_DIR      default for --state-dir (fallback: ~/.awf-node)\n  AWF_API_TOKEN           platform user token (or the env var named by --token-env)\n  AWF_NODE_PASSWORD       default for --password\n  AWF_NODE_LLM_BASE_URL   OpenAI-compatible endpoint for llm/task steps\n  AWF_NODE_LLM_API_KEY    Bearer key for that endpoint (optional)\n  AWF_NODE_LLM_MODEL      default model for llm/task steps\n  AWF_NODE_TUNNEL_TARGET  default local target for tunnel (default: http://127.0.0.1:8788)\n";
export declare function main(): Promise<void>;
//# sourceMappingURL=cli.d.ts.map