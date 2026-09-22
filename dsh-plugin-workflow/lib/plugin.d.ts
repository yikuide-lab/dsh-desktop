/**
 * DSH Workflow Plugin
 * Integrates workflow engine as a Cordis plugin for DSH Desktop
 */
import { Coordinator } from './engine/coordinator.js';
import { type DesktopExecutorHooks, type StepOutcome } from './engine/executor.js';
import { type TriggerConfig } from './triggers/trigger.js';
import { type WorkflowTemplateDefinition } from './templates.js';
import { type UserTemplateRecord } from './user-templates.js';
import { validateWorkflow } from './engine/models.js';
import { type TranscriptEvent } from './engine/transcript.js';
import { type WorkflowStatsDetail, type WorkflowStatsSummary } from './engine/workflow-stats.js';
import type { Workflow, Run, Executor, Step, ExecutionContext } from './engine/models.js';
export interface WorkflowPluginConfig {
    stateDir?: string;
    maxConcurrency?: number;
    /** Maximum concurrently live workflow runs (including nested sub_workflow runs). */
    maxActiveRuns?: number;
    /** Maximum sub_workflow nesting depth (root = 1). */
    maxNestedDepth?: number;
    tickInterval?: number;
    /** Fail in-flight dispatches past per-step timeout / stall ceiling (ms). */
    heartbeatTimeout?: number;
    mcpEnabled?: boolean;
    /** When true, expose destructive MCP tools (delete, stop, resolve with tokens). */
    mcpDangerousToolsEnabled?: boolean;
    triggersEnabled?: boolean;
    /** Script execution policy (default allow with cwd jail when WORKSPACE_ROOT set). */
    scriptPolicy?: 'allow' | 'deny' | 'workspace-only';
    /** Keep at most this many finished runs (0 = unlimited). */
    maxRetainedRuns?: number;
    /** Delete finished runs older than this many days (0 = unlimited). */
    maxRunAgeDays?: number;
}
/** Internal params key tracking workflow names already on the call stack. */
export declare const WORKFLOW_STACK_PARAM = "__workflowStack";
export interface StartRunOptions {
    parentRunId?: string;
    rootRunId?: string;
}
export interface WorkspaceBinding {
    workspaceId: string;
    workflowName: string;
    updatedAt: string;
}
/** Preferred LLM route for workflow steps by capability bias. */
export interface WorkflowLlmProviderPref {
    id: string;
    /** Fully-qualified `provider/model` route. */
    model: string;
    /** Capability tags such as coding, review, security, router. */
    bias: string[];
}
/** Persisted workflow LLM preference document. */
export interface WorkflowSettings {
    providers: WorkflowLlmProviderPref[];
    defaultBias: string;
    /** Extra attempts after the first step failure. */
    defaultRetries: number;
    /** Applied when a step omits on_failure. */
    defaultOnFailure: 'fail' | 'skip' | 'compensate';
    /** Optional retention overrides (0 = unlimited). */
    maxRetainedRuns?: number;
    maxRunAgeDays?: number;
    /** Script execution policy override. */
    scriptPolicy?: 'allow' | 'deny' | 'workspace-only';
}
export declare function defaultWorkflowSettings(): WorkflowSettings;
/** True when a running run only waits on unresolved gates (no in-flight work). */
export declare function isWaitingOnlyOnGates(run: Run): boolean;
export interface PendingGateView {
    runId: string;
    stepId: string;
    question: string;
    options: string[];
    pass?: string[];
    token: string;
}
export declare class WorkflowPlugin {
    private store;
    private coordinators;
    private persistQueues;
    private triggerManager;
    private mcpServer;
    private config;
    private executor;
    private hostHooks;
    private bindingsPath;
    private settingsPath;
    private triggersPath;
    private settings;
    private userTemplates;
    constructor(config?: WorkflowPluginConfig);
    /** Replace Host LLM/task hooks while keeping nested sub_workflow wired. */
    setHostHooks(hooks?: DesktopExecutorHooks): void;
    /** Replace the step executor used by new runs (advanced; prefer setHostHooks). */
    setExecutor(executor: Executor): void;
    private rebuildExecutor;
    private safeTranscript;
    private schedulePersist;
    private createCoordinator;
    private detachCoordinator;
    private countActiveRuns;
    private listLiveRuns;
    private getLiveCoordinator;
    init(): Promise<void>;
    /** Fail-closed: mark disk runs still "running" as aborted after process restart,
     * unless they are only waiting on unresolved gates with no in-flight dispatches. */
    private recoverOrphanRuns;
    startMCP(): Promise<void>;
    createWorkflow(yaml: string): Promise<{
        workflow: Workflow;
        validation: ReturnType<typeof validateWorkflow>;
    }>;
    validateYaml(yaml: string): Promise<ReturnType<typeof validateWorkflow>>;
    getWorkflow(name: string): Promise<Workflow | null>;
    listWorkflows(): Promise<Workflow[]>;
    deleteWorkflow(name: string): Promise<boolean>;
    exportWorkflowYaml(name: string): Promise<string | null>;
    /** Parse YAML then dump with Host js-yaml (canonical round-trip). */
    canonicalizeYaml(yaml: string): Promise<string>;
    listTemplates(): WorkflowTemplateDefinition[];
    /**
     * Persist a user template (import or promote-from-workflow).
     * Built-in ids cannot be overwritten.
     */
    saveUserTemplate(input: {
        yaml: string;
        name?: string;
        description?: string;
        category?: WorkflowTemplateDefinition['category'];
        id?: string;
        sourceWorkflowName?: string;
    }): Promise<UserTemplateRecord>;
    /** Delete a user-saved template. Built-ins cannot be removed. */
    deleteUserTemplate(id: string): Promise<boolean>;
    /**
     * Promote a saved workflow into the user template catalog.
     * Does not delete or alter the original workflow.
     */
    promoteWorkflowToTemplate(workflowName: string, options?: {
        name?: string;
        description?: string;
        category?: WorkflowTemplateDefinition['category'];
        id?: string;
    }): Promise<UserTemplateRecord>;
    /** Synchronous cached settings for Host executor routing. */
    getSettingsSync(): WorkflowSettings;
    getSettings(): Promise<WorkflowSettings>;
    setSettings(settings: WorkflowSettings): Promise<WorkflowSettings>;
    startRun(workflowName: string, params?: Record<string, unknown>, options?: StartRunOptions): Promise<Run>;
    getRun(runId: string): Promise<Run | null>;
    listRuns(workflowName?: string): Promise<Run[]>;
    stopRun(runId: string): Promise<Run>;
    /**
     * Synchronously nest a child workflow run for a sub_workflow step.
     * Honors AbortSignal (parent step abort) and circular-ref / depth guards.
     */
    executeSubWorkflow(step: Step, context: ExecutionContext, signal: AbortSignal): Promise<StepOutcome>;
    listPendingGates(runId?: string): Promise<PendingGateView[]>;
    resolveGate(runId: string, stepId: string, decision: string, resolvedBy: string, token: string): Promise<Run>;
    /** Resume a persisted running run with a live coordinator + tick loop. */
    private reattachRun;
    getTranscript(runId: string, options?: {
        after?: string;
        limit?: number;
    }): Promise<{
        events: TranscriptEvent[];
        nextAfter?: string;
    }>;
    listBindings(): Promise<WorkspaceBinding[]>;
    getBinding(workspaceId: string): Promise<WorkspaceBinding | null>;
    setBinding(workspaceId: string, workflowName: string): Promise<WorkspaceBinding>;
    clearBinding(workspaceId: string): Promise<boolean>;
    /** Start the workflow bound to a workspace, injecting workspace context. */
    startBoundRun(workspaceId: string, params?: Record<string, unknown>): Promise<Run>;
    /** Whether MCP may invoke destructive tools (delete/stop/resolve). */
    areDangerousMcpToolsEnabled(): boolean;
    addTrigger(config: TriggerConfig): {
        id: string;
        config: TriggerConfig;
    };
    removeTrigger(id: string): boolean;
    enableTrigger(id: string): void;
    disableTrigger(id: string): void;
    fireManualTrigger(triggerId: string, params?: Record<string, unknown>): void;
    listTriggers(): Array<{
        id: string;
        config: TriggerConfig;
        enabled: boolean;
        nextTrigger?: string;
    }>;
    deleteRun(runId: string): Promise<boolean>;
    exportRun(runId: string): Promise<{
        schemaVersion: number;
        run: Run;
        transcript: TranscriptEvent[];
    } | null>;
    purgeRuns(options?: {
        quiet?: boolean;
    }): Promise<{
        deleted: number;
    }>;
    fireEvent(source: string, name: string, data?: Record<string, unknown>): void;
    private assertTriggersEnabled;
    private handleTrigger;
    getStats(): Promise<{
        workflows: number;
        runs: {
            total: number;
            running: number;
            completed: number;
            failed: number;
        };
        triggers: number;
        activeRuns: number;
        maxActiveRuns: number;
        apiVersion: number;
        runSchemaVersion: number;
        coordinators: Array<{
            runId: string;
            stats: ReturnType<Coordinator['getStats']>;
        }>;
    }>;
    /**
     * Per-workflow usage summaries from retained top-level runs.
     * When `workflowName` is set, returns a single-element array (zeros if unknown / no runs).
     */
    getWorkflowStats(workflowName?: string): Promise<WorkflowStatsSummary[]>;
    getWorkflowStatsDetail(workflowName: string, options?: {
        since?: string;
        recentLimit?: number;
    }): Promise<WorkflowStatsDetail>;
    private shutdown;
    stop(): void;
    /** Await in-flight shutdown from {@link stop} (tests / Host teardown). */
    whenStopped(): Promise<void>;
    private readBindings;
    private writeBindings;
    private readSettings;
    private persistTriggers;
    private loadPersistedTriggers;
}
export declare function createWorkflowPlugin(config?: WorkflowPluginConfig): WorkflowPlugin;
export default WorkflowPlugin;
//# sourceMappingURL=plugin.d.ts.map