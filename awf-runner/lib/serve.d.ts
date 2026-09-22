/**
 * awf-node serve: register this node as an AWF executor and run the
 * claim → execute → result loop against the platform, executing claimed
 * tasks through a local WorkflowPlugin (dsh-plugin-workflow engine) wired
 * with the headless Node LLM hooks.
 *
 * State layout (mirrors the desktop convention where stateDir is
 * `~/.dsh/workflow` and awf.json / awf-executor.json live one level up):
 *   <stateDir>/awf.json            platform connection settings (0600)
 *   <stateDir>/awf-auth.json       optional login session (0600)
 *   <stateDir>/awf-executor.json   executor id + token (0600)
 *   <stateDir>/workflow/           workflow engine state (runs, transcripts)
 */
import { WorkflowPlugin } from 'dsh-plugin-workflow';
import type { Workflow } from 'dsh-plugin-workflow/engine';
import type { AwfFetch } from './awf/client.js';
import type { AwfClaimedTask, AwfExecutorLoopStatus, AwfTaskResult } from './awf/executor.js';
export declare const DEFAULT_CLAIM_WAIT_SEC = 25;
export interface ServeOptions {
    /** Node home (see layout above); CLI default: ~/.awf-node or AWF_NODE_STATE_DIR. */
    readonly stateDir: string;
    /** Platform base URL override (persisted into awf.json). */
    readonly platform?: string;
    /** Env var name holding the platform user token (persisted into awf.json). */
    readonly tokenEnv?: string;
    readonly concurrency?: number;
    readonly labels?: Record<string, string>;
    /** Claim long-poll budget (0..30, default 25). */
    readonly claimWaitSec?: number;
    readonly heartbeatMs?: number;
    readonly claimIntervalMs?: number;
    /** Coordinator tick for the local engine (default 250ms on a node). */
    readonly engineTickMs?: number;
    /** Test seams. */
    readonly env?: Record<string, string | undefined>;
    readonly fetchImpl?: AwfFetch;
    readonly logger?: (message: string) => void;
}
export interface ServeHandle {
    stop(): Promise<void>;
    status(): AwfExecutorLoopStatus;
}
/** Workflow-engine state dir nested inside the node home. */
export declare function workflowStateDir(stateDir: string): string;
/** Map a claimed platform task onto a single-step workflow definition. */
export declare function claimedTaskWorkflow(task: AwfClaimedTask): {
    workflow: Workflow;
    stepId: string;
};
/**
 * Execute one claimed task as a synthetic one-step workflow run on the local
 * engine. Returns the honest result (never throws for task-level failures).
 */
export declare function runClaimedTask(plugin: WorkflowPlugin, task: AwfClaimedTask, signal: AbortSignal): Promise<AwfTaskResult>;
/**
 * Start the headless runner: persist connection overrides, wire the engine
 * with the Node LLM hooks, and start the executor loop. Resolves once the
 * loop is started; the returned handle stops everything gracefully.
 */
export declare function serve(options: ServeOptions): Promise<ServeHandle>;
//# sourceMappingURL=serve.d.ts.map