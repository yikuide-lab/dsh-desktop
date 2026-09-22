/**
 * Workflow Engine Models
 * TypeScript rewrite of workflow-wise engine/models.py
 */

// ============================================================================
// Enums
// ============================================================================

export enum WorkflowStatus {
  Draft = 'draft',
  Proposed = 'proposed',
  Reviewing = 'reviewing',
  Approved = 'approved',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Aborted = 'aborted',
  Rejected = 'rejected',
}

export enum TaskStatus {
  Pending = 'pending',
  Ready = 'ready',
  InProgress = 'in_progress',
  Blocked = 'blocked',
  Completed = 'completed',
  Failed = 'failed',
  Skipped = 'skipped',
}

export enum DispatchStatus {
  Queued = 'queued',
  Running = 'running',
  Succeeded = 'succeeded',
  Failed = 'failed',
}

export enum StepType {
  Script = 'script',
  Task = 'task',
  LLM = 'llm',
  Approval = 'approval',
  SubWorkflow = 'sub_workflow',
}

export enum TriggerType {
  Manual = 'manual',
  Cron = 'cron',
  Event = 'event',
}

// ============================================================================
// Interfaces
// ============================================================================

export interface WorkflowMetadata {
  /**
   * Stable document identity (UUID). Storage and updates key on this field.
   * Generated on first save when missing; never change for an existing workflow.
   */
  uid?: string;
  name: string;          // [a-z0-9-]+, <=63 chars, unique among workflows
  title?: string;        // human-readable title
  description?: string;
  version?: string;
  labels?: Record<string, string>;
  /** Capability negotiation (AWF twin DSL): step types / features this workflow needs. */
  requires?: string[];
}

export interface Trigger {
  type: TriggerType;
  schedule?: string;     // 5-field cron expression
  source?: string;       // event source
  on?: string;           // event name
  filter?: string;       // filter expression
}

export interface Compensation {
  run: string;
  env?: Record<string, string>;
}

/** Policy applied after a step exhausts its retry budget. */
export type OnFailurePolicy = 'fail' | 'skip' | 'compensate';

export interface Step {
  id: string;            // [a-z0-9-]+, <=63 chars, unique within workflow
  type: StepType;
  deps?: string[];       // dependency step IDs
  /** Extra attempts after the first failure. Omit to use global defaultRetries. */
  retries?: number;
  on_failure?: OnFailurePolicy;
  compensation?: Compensation;

  // Script step
  run?: string;
  env?: Record<string, string>;
  timeout?: number;

  // Task step (code agent)
  inputs?: Record<string, unknown>;
  outputs?: string[];
  acceptance?: string[];
  harness?: string;
  role?: string;

  // LLM step
  prompt?: string;
  model?: string;
  /** Optional completion token budget for LLM steps (Host executor). */
  maxTokens?: number;

  // Approval step
  question?: string;
  options?: string[];
  /**
   * Decisions that complete the approval gate successfully.
   * Defaults to `['approved']` when present in options, otherwise `[options[0]]`.
   */
  pass?: string[];

  // Sub-workflow step
  ref?: string;

  /** Optional canvas layout hint preserved across YAML round-trips. */
  ui?: { x: number; y: number };
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

// ============================================================================
// Runtime Models
// ============================================================================

export interface Dispatch {
  id: string;
  stepId: string;
  status: DispatchStatus;
  attempt: number;
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
export const RUN_SCHEMA_VERSION = 1

export interface WorkflowState {
  workflow: Workflow;
  status: WorkflowStatus;
  createdAt: string;
  updatedAt: string;
  currentRun?: string;
}

// ============================================================================
// Validation
// ============================================================================

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
  order: string[];  // topological order of step IDs
}

// ============================================================================
// Execution
// ============================================================================

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
export const WORKFLOW_API_VERSION = 'workflow-wise/v1'

/** Legacy aliases normalized to {@link WORKFLOW_API_VERSION}. */
export const WORKFLOW_API_VERSION_ALIASES = ['wfwise.io/v1'] as const

export interface Executor {
  /** Begin work for an already-allocated dispatch id. */
  submit(dispatchId: string, step: Step, context: ExecutionContext): Promise<void>
  poll(dispatchId: string): Promise<Dispatch>
  abort(dispatchId: string): Promise<void>
}

// ============================================================================
// DSL Parser
// ============================================================================

export async function parseWorkflow(content: string): Promise<Workflow> {
  // Dynamic import for YAML parsing (ESM compatible)
  const yaml = await import('js-yaml');
  const doc = yaml.default.load(content);

  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('Workflow document must be a YAML mapping');
  }

  const root = doc as Record<string, unknown>;

  // Validate apiVersion (accept legacy alias used by early examples/UI)
  const apiVersion = typeof root.apiVersion === 'string' ? root.apiVersion : ''
  const normalizedApiVersion = (WORKFLOW_API_VERSION_ALIASES as readonly string[]).includes(apiVersion)
    ? WORKFLOW_API_VERSION
    : apiVersion
  if (normalizedApiVersion !== WORKFLOW_API_VERSION) {
    throw new Error(`Unsupported apiVersion: ${root.apiVersion}`)
  }

  // Validate kind
  if (root.kind !== 'Workflow') {
    throw new Error(`Unsupported kind: ${root.kind}`);
  }

  // Parse metadata
  if (!root.metadata || typeof root.metadata !== 'object') {
    throw new Error('metadata is required');
  }
  const meta = root.metadata as Record<string, unknown>;
  if (typeof meta.name !== 'string') {
    throw new Error('metadata.name is required and must be a string');
  }
  const uid = typeof meta.uid === 'string' && meta.uid.trim()
    ? meta.uid.trim()
    : undefined

  // Parse spec
  if (!root.spec || typeof root.spec !== 'object') {
    throw new Error('spec is required');
  }
  const spec = root.spec as Record<string, unknown>;
  if (!Array.isArray(spec.steps) || spec.steps.length === 0) {
    throw new Error('spec.steps must be a non-empty array');
  }

  // Parse steps
  const steps: Step[] = spec.steps.map((raw: Record<string, unknown>) => {
    if (typeof raw.id !== 'string') {
      throw new Error('Each step must have an "id" string');
    }
    if (typeof raw.type !== 'string') {
      throw new Error(`Step "${raw.id}" must have a "type" string`);
    }
    if (!Object.values(StepType).includes(raw.type as StepType)) {
      throw new Error(`Step "${raw.id}" has invalid type: ${raw.type}`);
    }
    const step = raw as unknown as Step
    if (raw.ui && typeof raw.ui === 'object' && !Array.isArray(raw.ui)) {
      const ui = raw.ui as Record<string, unknown>
      if (typeof ui.x === 'number' && typeof ui.y === 'number') {
        step.ui = { x: ui.x, y: ui.y }
      }
    }
    return step
  });

  // Build Workflow object
  const workflow: Workflow = {
    apiVersion: normalizedApiVersion,
    kind: root.kind as string,
    metadata: {
      name: meta.name as string,
      ...(uid ? { uid } : {}),
      ...(typeof meta.title === 'string' ? { title: meta.title } : {}),
      ...(typeof meta.description === 'string' ? { description: meta.description } : {}),
      ...(typeof meta.version === 'string' ? { version: meta.version } : {}),
      ...(meta.labels && typeof meta.labels === 'object' ? { labels: meta.labels as Record<string, string> } : {}),
      ...(Array.isArray(meta.requires)
        ? { requires: meta.requires.filter((r): r is string => typeof r === 'string') }
        : {}),
    },
    spec: {
      ...(spec.trigger && typeof spec.trigger === 'object' ? { trigger: spec.trigger as Trigger } : {}),
      ...(typeof spec.max_concurrency === 'number' ? { max_concurrency: spec.max_concurrency } : {}),
      ...(Array.isArray(spec.resources) ? { resources: spec.resources as Resource[] } : {}),
      steps,
    },
  };

  return workflow;
}

/** Serialize a workflow document to canonical YAML. */
export async function serializeWorkflow(workflow: Workflow): Promise<string> {
  const yaml = await import('js-yaml')
  const doc: Workflow = {
    ...workflow,
    apiVersion: WORKFLOW_API_VERSION,
    kind: 'Workflow',
  }
  return yaml.default.dump(doc, { lineWidth: 100, noRefs: true })
}

/** Local engine capability set — the preflight source for requires gating. */
export function engineCapabilities(): { dslVersion: string; stepTypes: string[]; features: string[] } {
  return {
    dslVersion: WORKFLOW_API_VERSION,
    stepTypes: Object.values(StepType) as string[],
    features: ['gate', 'compensation', 'sub_workflow', 'triggers'],
  }
}

export function validateWorkflow(workflow: Workflow): ValidationResult {
  const errors: ValidationError[] = [];
  const stepIds = new Set<string>();
  const order: string[] = [];

  // Check metadata
  if (!workflow.metadata?.name) {
    errors.push({ path: 'metadata.name', message: 'Name is required', severity: 'error' });
  } else if (!/^[a-z0-9-]+$/.test(workflow.metadata.name)) {
    errors.push({ path: 'metadata.name', message: 'Name must be [a-z0-9-]+', severity: 'error' });
  } else if (workflow.metadata.name.length > 63) {
    errors.push({ path: 'metadata.name', message: 'Name must be <= 63 chars', severity: 'error' });
  }

  // Capability negotiation: requires must be satisfiable by this engine.
  // Unknown capabilities fail loudly (capability_missing) — never silently skip.
  const available = engineCapabilities();
  for (const cap of workflow.metadata?.requires ?? []) {
    if (!available.stepTypes.includes(cap) && !available.features.includes(cap)) {
      errors.push({
        path: 'metadata.requires',
        message: `Capability not available on this engine: ${cap} (platform-only types may still sync to AWF; see workflow_capabilities / the AWF /api/dsl/capabilities endpoint)`,
        severity: 'error',
        code: 'capability_missing',
      });
    }
  }

  // Check steps
  if (!workflow.spec?.steps || workflow.spec.steps.length === 0) {
    errors.push({ path: 'spec.steps', message: 'At least one step is required', severity: 'error' });
    return { ok: errors.every((error) => error.severity !== 'error'), errors, order };
  }

  // Check for duplicate step IDs
  for (const step of workflow.spec.steps) {
    if (stepIds.has(step.id)) {
      errors.push({ path: `spec.steps.${step.id}`, message: 'Duplicate step ID', severity: 'error' });
    }
    stepIds.add(step.id);
  }

  // Check dependencies exist and detect cycles (Kahn's algorithm)
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const step of workflow.spec.steps) {
    inDegree.set(step.id, 0);
    adj.set(step.id, []);
  }

  for (const step of workflow.spec.steps) {
    for (const dep of step.deps ?? []) {
      if (!stepIds.has(dep)) {
        errors.push({
          path: `spec.steps.${step.id}.deps`,
          message: `Dependency "${dep}" not found`,
          severity: 'error',
        });
      } else {
        adj.get(dep)!.push(step.id);
        inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
      }
    }
  }

  // Kahn's algorithm for topological sort
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      const newDegree = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDegree);
      if (newDegree === 0) queue.push(next);
    }
  }

  // Check for cycles
  if (order.length !== stepIds.size) {
    errors.push({ path: 'spec.steps', message: 'Workflow contains a cycle', severity: 'error' });
  }

  // Validate each step
  for (const step of workflow.spec.steps) {
    validateStep(step, errors);
  }

  return { ok: errors.every((error) => error.severity !== 'error'), errors, order };
}

function validateStep(step: Step, errors: ValidationError[]): void {
  const path = `spec.steps.${step.id}`;

  // Validate step ID
  if (!/^[a-z0-9-]+$/.test(step.id)) {
    errors.push({ path, message: 'Step ID must be [a-z0-9-]+', severity: 'error' });
  }

  // Validate step type
  if (!Object.values(StepType).includes(step.type)) {
    errors.push({ path: `${path}.type`, message: `Invalid step type: ${step.type}`, severity: 'error' });
    return;
  }

  // Type-specific validation
  switch (step.type) {
    case StepType.Script:
      if (!step.run) {
        errors.push({ path: `${path}.run`, message: 'Script step requires "run"', severity: 'error' });
      }
      break;

    case StepType.Task:
      if (!step.inputs && !step.run) {
        errors.push({ path, message: 'Task step requires "inputs" or "run"', severity: 'warning' });
      }
      break;

    case StepType.LLM:
      if (!step.prompt) {
        errors.push({ path: `${path}.prompt`, message: 'LLM step requires "prompt"', severity: 'error' });
      }
      break;

    case StepType.Approval:
      if (!step.question) {
        errors.push({ path: `${path}.question`, message: 'Approval step requires "question"', severity: 'error' });
      }
      if (!step.options || step.options.length === 0) {
        errors.push({ path: `${path}.options`, message: 'Approval step requires "options"', severity: 'error' });
      }
      break;

    case StepType.SubWorkflow:
      if (!step.ref) {
        errors.push({ path: `${path}.ref`, message: 'Sub-workflow step requires "ref"', severity: 'error' });
      }
      break;
  }

  if (step.retries !== undefined) {
    if (typeof step.retries !== 'number' || !Number.isInteger(step.retries) || step.retries < 0) {
      errors.push({ path: `${path}.retries`, message: 'retries must be a non-negative integer', severity: 'error' });
    }
  }

  if (step.on_failure !== undefined
    && step.on_failure !== 'fail'
    && step.on_failure !== 'skip'
    && step.on_failure !== 'compensate') {
    errors.push({
      path: `${path}.on_failure`,
      message: 'on_failure must be fail, skip, or compensate',
      severity: 'error',
    });
  }

  // Validate compensation
  if (step.on_failure === 'compensate' && !step.compensation) {
    errors.push({ path, message: 'on_failure=compensate requires "compensation"', severity: 'error' });
  }
}
