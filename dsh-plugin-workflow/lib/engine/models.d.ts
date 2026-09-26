/**
 * Workflow Engine Models
 * TypeScript rewrite of workflow-wise engine/models.py
 */
export declare enum WorkflowStatus {
    Draft = "draft",
    Proposed = "proposed",
    Reviewing = "reviewing",
    Approved = "approved",
    Running = "running",
    Completed = "completed",
    Failed = "failed",
    Aborted = "aborted",
    Rejected = "rejected"
}
export declare enum TaskStatus {
    Pending = "pending",
    InProgress = "in_progress",
    Completed = "completed",
    Failed = "failed",
    Skipped = "skipped"
}
export declare enum DispatchStatus {
    Queued = "queued",
    Running = "running",
    Succeeded = "succeeded",
    Failed = "failed"
}
export declare enum StepType {
    Script = "script",
    Task = "task",
    LLM = "llm",
    Approval = "approval",
    SubWorkflow = "sub_workflow",
    CollabPeer = "collab_peer"
}
export declare enum TriggerType {
    Manual = "manual",
    Cron = "cron",
    Event = "event"
}
export interface WorkflowMetadata {
    /**
     * Stable document identity (UUID). Storage and updates key on this field.
     * Generated on first save when missing; never change for an existing workflow.
     */
    uid?: string;
    name: string;
    title?: string;
    description?: string;
    version?: string;
    labels?: Record<string, string>;
    /** Capability negotiation (AWF twin DSL): step types / features this workflow needs. */
    requires?: string[];
}
export interface Trigger {
    type: TriggerType;
    schedule?: string;
    source?: string;
    on?: string;
    filter?: string;
}
export interface Compensation {
    run: string;
    env?: Record<string, string>;
}
/** Policy applied after a step exhausts its retry budget. */
export type OnFailurePolicy = 'fail' | 'skip' | 'compensate';
export interface Step {
    id: string;
    type: StepType;
    deps?: string[];
    /** Extra attempts after the first failure. Omit to use global defaultRetries. */
    retries?: number;
    on_failure?: OnFailurePolicy;
    compensation?: Compensation;
    run?: string;
    env?: Record<string, string>;
    timeout?: number;
    inputs?: Record<string, unknown>;
    outputs?: string[];
    acceptance?: string[];
    harness?: string;
    role?: string;
    prompt?: string;
    model?: string;
    /** Optional completion token budget for LLM steps (Host executor). */
    maxTokens?: number;
    question?: string;
    options?: string[];
    /**
     * Decisions that complete the approval gate successfully.
     * Defaults to `['approved']` when present in options, otherwise `[options[0]]`.
     */
    pass?: string[];
    ref?: string;
    peer?: {
        kind: 'session' | 'agent' | 'workflow';
        jid?: string;
        role?: string;
        goals?: string[];
        grant?: string[];
        open?: boolean;
        slot?: string;
        quorum?: number;
        heartbeatMs?: number;
        offlineGraceMs?: number;
        rejoin?: 'resume' | 'replace' | 'reject';
    };
    /** Optional canvas layout hint preserved across YAML round-trips. */
    ui?: {
        x: number;
        y: number;
    };
}
export interface Resource {
    name: string;
    type?: string;
    limit?: number;
}
export interface WorkflowSpec {
    trigger?: Trigger;
    max_concurrency?: number;
    resources?: Resource[];
    steps: Step[];
}
export interface Workflow {
    apiVersion: string;
    kind: string;
    metadata: WorkflowMetadata;
    spec: WorkflowSpec;
}
export interface Dispatch {
    id: string;
    stepId: string;
    status: DispatchStatus;
    /**
     * Attempt number tracked by the engine (`dispatchTask` / `dispatchCompensation`).
     * Optional because `Executor.poll` results are status probes and do not carry it.
     */
    attempt?: number;
    /** Normal step work vs post-failure compensation script. */
    phase?: 'execute' | 'compensate';
    startedAt?: string;
    completedAt?: string;
    result?: unknown;
    error?: string;
    cost?: number;
}
export interface Task {
    id: string;
    stepId: string;
    status: TaskStatus;
    dispatches: Dispatch[];
    startedAt?: string;
    completedAt?: string;
    result?: unknown;
    error?: string;
}
export interface Gate {
    id: string;
    stepId: string;
    question: string;
    options: string[];
    /** Decisions that mark the gate task completed (see Step.pass). */
    pass?: string[];
    kind?: 'approval' | 'collab_join';
    resolved?: string;
    resolvedBy?: string;
    resolvedAt?: string;
    token?: string;
}
export interface Run {
    id: string;
    workflowName: string;
    status: WorkflowStatus;
    params?: Record<string, unknown>;
    tasks: Record<string, Task>;
    gates: Record<string, Gate>;
    /** Persisted shared-vision blackboard for resume. */
    shared?: Record<string, unknown>;
    startedAt: string;
    completedAt?: string;
    error?: string;
    coordinatorId?: string;
    /** Parent run id when this run was started by a sub_workflow step. */
    parentRunId?: string;
    /** Root ancestor run id for nested sub_workflow chains. */
    rootRunId?: string;
    /** Document schema version for forward-compatible loaders. */
    schemaVersion?: number;
}
/** Current on-disk Run JSON schema version written by this package. */
export declare const RUN_SCHEMA_VERSION = 1;
export interface WorkflowState {
    workflow: Workflow;
    status: WorkflowStatus;
    createdAt: string;
    updatedAt: string;
    currentRun?: string;
}
export interface ValidationError {
    path: string;
    message: string;
    severity: 'error' | 'warning';
    /** Machine-readable classification, e.g. capability_missing for requires gating. */
    code?: string;
}
export interface ValidationResult {
    ok: boolean;
    errors: ValidationError[];
    order: string[];
}
export interface ExecutionContext {
    runId: string;
    workflow: Workflow;
    stateDir: string;
    env?: Record<string, string>;
    /** Optional run parameters for prompt substitution. */
    params?: Record<string, unknown>;
    /** Completed dependency step outputs keyed by step id. */
    stepOutputs?: Record<string, unknown>;
    /** Run-level blackboard merged from step results (shared vision). */
    shared?: Record<string, unknown>;
}
export interface StepResult {
    success: boolean;
    output?: unknown;
    error?: string;
    cost?: number;
}
/** Canonical workflow document version accepted by the parser. */
export declare const WORKFLOW_API_VERSION = "workflow-wise/v1";
/** Legacy aliases normalized to {@link WORKFLOW_API_VERSION}. */
export declare const WORKFLOW_API_VERSION_ALIASES: readonly ["wfwise.io/v1"];
export interface Executor {
    /** Begin work for an already-allocated dispatch id. */
    submit(dispatchId: string, step: Step, context: ExecutionContext): Promise<void>;
    poll(dispatchId: string): Promise<Dispatch>;
    abort(dispatchId: string): Promise<void>;
}
export declare function parseWorkflow(content: string): Promise<Workflow>;
/** Serialize a workflow document to canonical YAML. */
export declare function serializeWorkflow(workflow: Workflow): Promise<string>;
/** Local engine capability set — the preflight source for requires gating. */
export declare function engineCapabilities(): {
    dslVersion: string;
    stepTypes: string[];
    features: string[];
};
export declare function validateWorkflow(workflow: Workflow): ValidationResult;
//# sourceMappingURL=models.d.ts.map