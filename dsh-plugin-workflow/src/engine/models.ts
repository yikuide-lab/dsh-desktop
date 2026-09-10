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
  name: string;          // [a-z0-9-]+, <=63 chars, globally unique
  title?: string;        // human-readable title
  description?: string;
  version?: string;
  labels?: Record<string, string>;
}

export interface Trigger {
  type: TriggerType;
  schedule?: string;     // 5-field cron expression
  timezone?: string;
  source?: string;       // event source
  on?: string;           // event name
  filter?: string;       // filter expression
}

export interface Compensation {
  run: string;
  env?: Record<string, string>;
}

export interface Step {
  id: string;            // [a-z0-9-]+, <=63 chars, unique within workflow
  type: StepType;
  deps?: string[];       // dependency step IDs
  on_failure?: 'fail' | 'compensate';
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

  // Approval step
  question?: string;
  options?: string[];

  // Sub-workflow step
  ref?: string;
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
  startedAt: string;
  completedAt?: string;
  error?: string;
  coordinatorId?: string;
}

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
}

export interface StepResult {
  success: boolean;
  output?: unknown;
  error?: string;
  cost?: number;
}

export interface Executor {
  submit(step: Step, context: ExecutionContext): Promise<string>;  // returns dispatch ID
  poll(dispatchId: string): Promise<Dispatch>;
  abort(dispatchId: string): Promise<void>;
}

// ============================================================================
// DSL Parser
// ============================================================================

export function parseWorkflow(yaml: string): Workflow {
  // Dynamic import for YAML parsing
  // Will be implemented with js-yaml
  throw new Error('Not implemented');
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

  // Check steps
  if (!workflow.spec?.steps || workflow.spec.steps.length === 0) {
    errors.push({ path: 'spec.steps', message: 'At least one step is required', severity: 'error' });
    return { ok: errors.length === 0, errors, order };
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

  return { ok: errors.length === 0, errors, order };
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

  // Validate compensation
  if (step.on_failure === 'compensate' && !step.compensation) {
    errors.push({ path, message: 'on_failure=compensate requires "compensation"', severity: 'error' });
  }
}
