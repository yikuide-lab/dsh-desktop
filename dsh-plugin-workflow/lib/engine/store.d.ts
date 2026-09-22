/**
 * Workflow Store
 * File-based persistence for workflows and runs
 */
import type { Workflow, WorkflowState, Run } from './models.js';
import { type TranscriptEvent } from './transcript.js';
/** Allocate or reuse a stable workflow document uid. */
export declare function ensureWorkflowUid(workflow: Workflow): string;
export declare class WorkflowStore {
    private stateDir;
    /** Serialize read-modify-write updates per run id. */
    private runChains;
    constructor(stateDir: string);
    getStateDir(): string;
    /**
     * Initialize the store directories
     */
    init(): Promise<void>;
    private workflowsDir;
    private workflowPathByUid;
    private workflowPathByName;
    private readStateFile;
    /**
     * Rewrite legacy `{name}.json` files to `{uid}.json` and backfill missing uids.
     */
    private migrateWorkflowFiles;
    private withRunLock;
    /**
     * Save a workflow definition keyed by metadata.uid (stable across renames).
     * When uid is omitted, reuse the existing document that already owns this name.
     */
    saveWorkflow(workflow: Workflow): Promise<WorkflowState>;
    private loadWorkflowByUid;
    /**
     * Load a workflow by uid or by human-readable name.
     */
    loadWorkflow(nameOrUid: string): Promise<WorkflowState | null>;
    private listWorkflowsRaw;
    /**
     * List all workflows (migrates legacy files as needed).
     */
    listWorkflows(): Promise<WorkflowState[]>;
    /**
     * Delete a workflow by uid or name.
     */
    deleteWorkflow(nameOrUid: string): Promise<boolean>;
    /**
     * Save a run (atomic tmp + rename)
     */
    saveRun(run: Run): Promise<void>;
    /**
     * Load a run by ID
     */
    loadRun(runId: string): Promise<Run | null>;
    /**
     * List all runs for a workflow
     */
    listRuns(workflowName?: string): Promise<Run[]>;
    /**
     * Update a run under a per-run mutex
     */
    updateRun(runId: string, updater: (run: Run) => Run): Promise<Run>;
    /**
     * Delete a run
     */
    deleteRun(runId: string): Promise<boolean>;
    appendTranscript(runId: string, event: Omit<TranscriptEvent, 'ts'> & {
        ts?: string;
    }): Promise<TranscriptEvent>;
    loadTranscript(runId: string, options?: {
        after?: string;
        limit?: number;
    }): Promise<{
        events: TranscriptEvent[];
        nextAfter?: string;
    }>;
    /**
     * Get workflow statistics
     */
    getStats(workflowName: string): Promise<{
        totalRuns: number;
        completedRuns: number;
        failedRuns: number;
    }>;
}
//# sourceMappingURL=store.d.ts.map