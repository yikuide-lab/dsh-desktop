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
import type { AwfFetch } from './client.js';
import type { AwfSettings } from './settings.js';
/** A task claimed from the platform queue (POST /api/executors/claim). */
export interface AwfClaimedTask {
    readonly id: number;
    readonly workflow_name: string;
    readonly step_id: string;
    readonly payload: Record<string, unknown>;
    readonly deadline_at: string | null;
}
/** Result posted back to POST /api/executors/tasks/:id/result. */
export interface AwfTaskResult {
    ok: boolean;
    output?: string;
    error?: string;
}
export interface AwfExecutorLoopOptions {
    readonly stateDir: string;
    /** Executes one claimed task; must resolve (not throw) with an honest result. */
    readonly runTask: (task: AwfClaimedTask, signal: AbortSignal) => Promise<AwfTaskResult>;
    readonly log?: (message: string) => void;
    /** Test seams: inject fetch / env without touching globals. */
    readonly fetchImpl?: AwfFetch;
    readonly env?: Record<string, string | undefined>;
    readonly heartbeatMs?: number;
    readonly claimIntervalMs?: number;
    /**
     * Long-poll budget passed as ?wait_sec= to POST /api/executors/claim
     * (platform supports 0..30). 0 disables long-polling (classic poll cadence).
     */
    readonly claimWaitSec?: number;
    /** Max tasks executed concurrently (1..32). 1 keeps strict sequential order. */
    readonly concurrency?: number;
    /** Executor name sent at registration. */
    readonly registerName?: string;
    /** Capability flags sent at registration. */
    readonly capabilities?: Record<string, unknown>;
    /** Flat string labels sent at registration (queue routing). */
    readonly labels?: Record<string, string>;
    /** Gate for start() (e.g. settings.executorEnabled on desktop). Default: always on. */
    readonly isEnabled?: () => Promise<boolean>;
    /**
     * Resolve the platform user JWT used for one-time executor registration.
     * Default: env-var > saved-token chain from settings.
     */
    readonly resolveUserToken?: (settings: AwfSettings) => Promise<string | null>;
}
export interface AwfExecutorLoopStatus {
    readonly running: boolean;
    readonly registered: boolean;
    readonly executorId: number | null;
    /** First in-flight task id (compat with the desktop status view). */
    readonly executingTaskId: number | null;
    /** Number of tasks currently executing. */
    readonly executingCount: number;
    readonly lastClaimAt: string | null;
    readonly lastError: string | null;
}
export interface AwfExecutorLoopController {
    start(): void;
    stop(): Promise<void>;
    status(): AwfExecutorLoopStatus;
}
/** 执行器凭据文件（0600，与 awf.json 同目录）；token 只落盘、不回显。 */
export declare function awfExecutorCredentialsPath(stateDir: string): string;
export declare function createAwfExecutorLoop(options: AwfExecutorLoopOptions): AwfExecutorLoopController;
//# sourceMappingURL=executor.d.ts.map