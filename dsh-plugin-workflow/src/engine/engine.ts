/**
 * Workflow Execution Engine
 * TypeScript rewrite of workflow-wise engine/engine.ts
 */

import { randomUUID } from 'node:crypto';
import {
  type Workflow,
  type Run,
  type Task,
  type Gate,
  type Dispatch,
  type Step,
  type StepResult,
  type OnFailurePolicy,
  type Compensation,
  WorkflowStatus,
  TaskStatus,
  DispatchStatus,
  StepType,
  RUN_SCHEMA_VERSION,
} from './models.js';

/**
 * Effective dispatch concurrency for a workflow run.
 * Takes the minimum of coordinator default, spec.max_concurrency, and
 * resources named/typed `concurrency` with a numeric limit.
 */
export function resolveEffectiveConcurrency(
  workflow: Workflow,
  fallback: number,
): number {
  let limit = Math.max(1, fallback);
  if (typeof workflow.spec.max_concurrency === 'number' && workflow.spec.max_concurrency >= 1) {
    limit = Math.min(limit, workflow.spec.max_concurrency);
  }
  for (const resource of workflow.spec.resources ?? []) {
    if (
      (resource.name === 'concurrency' || resource.type === 'concurrency')
      && typeof resource.limit === 'number'
      && resource.limit >= 1
    ) {
      limit = Math.min(limit, resource.limit);
    }
  }
  return limit;
}

/** Defaults applied when a step omits retries / on_failure. */
export interface FailurePolicyDefaults {
  defaultRetries: number;
  defaultOnFailure: OnFailurePolicy;
}

export const DEFAULT_FAILURE_POLICY: FailurePolicyDefaults = {
  defaultRetries: 2,
  defaultOnFailure: 'fail',
};

export function resolveRetryLimit(
  step: Step | undefined,
  defaults: FailurePolicyDefaults = DEFAULT_FAILURE_POLICY,
): number {
  const retries = typeof step?.retries === 'number' && step.retries >= 0
    ? step.retries
    : defaults.defaultRetries;
  return retries + 1; // total failed attempts before failback
}

export function resolveOnFailure(
  step: Step | undefined,
  defaults: FailurePolicyDefaults = DEFAULT_FAILURE_POLICY,
): OnFailurePolicy {
  return step?.on_failure ?? defaults.defaultOnFailure;
}

// ============================================================================
// State Transitions
// ============================================================================

const VALID_TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  [WorkflowStatus.Draft]: [WorkflowStatus.Proposed],
  [WorkflowStatus.Proposed]: [WorkflowStatus.Reviewing, WorkflowStatus.Rejected],
  [WorkflowStatus.Reviewing]: [WorkflowStatus.Approved, WorkflowStatus.Rejected],
  [WorkflowStatus.Approved]: [WorkflowStatus.Running],
  [WorkflowStatus.Running]: [WorkflowStatus.Completed, WorkflowStatus.Failed, WorkflowStatus.Aborted],
  [WorkflowStatus.Completed]: [],
  [WorkflowStatus.Failed]: [WorkflowStatus.Running],  // can retry
  [WorkflowStatus.Aborted]: [],
  [WorkflowStatus.Rejected]: [WorkflowStatus.Draft],  // can revise
};

export function canTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionWorkflow(
  run: Run,
  to: WorkflowStatus,
  error?: string,
): Run {
  if (!canTransition(run.status, to)) {
    throw new Error(`Invalid transition: ${run.status} -> ${to}`);
  }

  const now = new Date().toISOString();
  const updated: Run = {
    ...run,
    status: to,
    ...(error !== undefined ? { error } : {}),
  };

  if (to === WorkflowStatus.Completed || to === WorkflowStatus.Failed || to === WorkflowStatus.Aborted) {
    updated.completedAt = now;
  }

  return updated;
}

// ============================================================================
// Run Management
// ============================================================================

export function createRun(
  workflow: Workflow,
  params?: Record<string, unknown>,
  coordinatorId?: string,
  lineage?: { parentRunId?: string; rootRunId?: string },
): Run {
  const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const tasks: Record<string, Task> = {};
  const gates: Record<string, Gate> = {};

  // Initialize tasks for each step
  for (const step of workflow.spec.steps) {
    tasks[step.id] = {
      id: `task-${step.id}`,
      stepId: step.id,
      status: TaskStatus.Pending,
      dispatches: [],
    };

    // Initialize gates for approval steps
    if (step.type === StepType.Approval) {
      gates[step.id] = buildApprovalGate(step);
    }

    // Open collab_peer slots wait for join before dispatch
    if (step.type === StepType.CollabPeer && collabPeerNeedsJoinGate(step)) {
      gates[step.id] = buildCollabJoinGate(step);
    }
  }

  const parentRunId = lineage?.parentRunId
  const rootRunId = lineage?.rootRunId ?? parentRunId

  return {
    id: runId,
    workflowName: workflow.metadata.name,
    status: WorkflowStatus.Running,
    params,
    tasks,
    gates,
    startedAt: new Date().toISOString(),
    coordinatorId,
    schemaVersion: RUN_SCHEMA_VERSION,
    ...(parentRunId ? { parentRunId } : {}),
    ...(rootRunId ? { rootRunId } : {}),
  };
}

// ============================================================================
// Ready Set Computation
// ============================================================================

/**
 * Compute the set of tasks that are ready to execute.
 * A task is ready when:
 * 1. Its status is Pending
 * 2. All dependencies are Completed or Skipped (skip/compensate failback)
 */
export function computeReady(run: Run, workflow: Workflow): string[] {
  const ready: string[] = [];

  for (const step of workflow.spec.steps) {
    const task = run.tasks[step.id];
    if (!task || task.status !== TaskStatus.Pending) continue;

    // Check if all dependencies are satisfied
    const deps = step.deps ?? [];
    const allDepsSatisfied = deps.every(depId => {
      const depTask = run.tasks[depId];
      return depTask?.status === TaskStatus.Completed
        || depTask?.status === TaskStatus.Skipped;
    });

    if (allDepsSatisfied) {
      ready.push(step.id);
    }
  }

  return ready;
}

/** Mark pending tasks unreachable because a hard-failed dependency will never complete. */
export function skipUnreachableTasks(run: Run, workflow: Workflow): Run {
  let tasks = run.tasks;
  let changed = true;
  while (changed) {
    changed = false;
    const next: Record<string, Task> = { ...tasks };
    for (const step of workflow.spec.steps) {
      const task = next[step.id];
      if (!task || task.status !== TaskStatus.Pending) continue;
      const deps = step.deps ?? [];
      const blockedByFailure = deps.some((depId) => next[depId]?.status === TaskStatus.Failed);
      if (!blockedByFailure) continue;
      next[step.id] = {
        ...task,
        status: TaskStatus.Skipped,
        error: task.error ?? 'skipped: dependency failed',
        completedAt: new Date().toISOString(),
      };
      changed = true;
    }
    tasks = next;
  }
  if (tasks === run.tasks) return run;
  return { ...run, tasks };
}

// ============================================================================
// Task Dispatch
// ============================================================================

export function dispatchTask(
  run: Run,
  stepId: string,
  concurrencyBudget: number,
): { run: Run; dispatchId: string } {
  const task = run.tasks[stepId];
  if (!task) {
    throw new Error(`Task not found: ${stepId}`);
  }

  if (task.status !== TaskStatus.Pending) {
    throw new Error(`Task ${stepId} is not pending (status: ${task.status})`);
  }

  // Check concurrency budget
  const runningCount = Object.values(run.tasks).filter(
    t => t.status === TaskStatus.InProgress,
  ).length;

  if (runningCount >= concurrencyBudget) {
    throw new Error(`Concurrency budget exceeded: ${runningCount}/${concurrencyBudget}`);
  }

  const failedAttempts = task.dispatches.filter(
    (d) => d.phase !== 'compensate' && d.status === DispatchStatus.Failed,
  ).length;
  const attempt = failedAttempts + 1;

  const dispatchId = `dispatch-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const dispatch: Dispatch = {
    id: dispatchId,
    stepId,
    status: DispatchStatus.Queued,
    attempt,
    phase: 'execute',
    startedAt: new Date().toISOString(),
  };

  const updatedRun: Run = {
    ...run,
    tasks: {
      ...run.tasks,
      [stepId]: {
        ...task,
        status: TaskStatus.InProgress,
        dispatches: [...task.dispatches, dispatch],
      },
    },
  };

  return { run: updatedRun, dispatchId };
}

// ============================================================================
// Dispatch Settlement
// ============================================================================

export interface SettleDispatchOptions {
  /** Required so retry/failback/compensate/skipUnreachable can see the step definition. */
  workflow: Workflow;
  defaults?: FailurePolicyDefaults;
}

export interface SettleDispatchResult {
  run: Run;
  /** When set, coordinator should submit the compensation script for this step. */
  pendingCompensation?: {
    stepId: string;
    compensation: Compensation;
    originalError?: string;
  };
}

export function settleDispatch(
  run: Run,
  dispatchId: string,
  result: StepResult,
  options: SettleDispatchOptions,
): SettleDispatchResult {
  // Find the task containing this dispatch
  let targetTask: Task | undefined;
  let targetStepId: string | undefined;
  let settledDispatch: Dispatch | undefined;

  for (const [stepId, task] of Object.entries(run.tasks)) {
    const dispatch = task.dispatches.find(d => d.id === dispatchId);
    if (dispatch) {
      targetTask = task;
      targetStepId = stepId;
      settledDispatch = dispatch;
      break;
    }
  }

  if (!targetTask || !targetStepId || !settledDispatch) {
    throw new Error(`Dispatch not found: ${dispatchId}`);
  }

  const workflow = options.workflow;
  const defaults = options.defaults ?? DEFAULT_FAILURE_POLICY;
  const step = workflow.spec.steps.find((entry) => entry.id === targetStepId);

  // Update dispatch status
  const dispatches = targetTask.dispatches.map(d => {
    if (d.id !== dispatchId) return d;
    return {
      ...d,
      status: result.success ? DispatchStatus.Succeeded : DispatchStatus.Failed,
      completedAt: new Date().toISOString(),
      result: result.output,
      error: result.error,
      cost: result.cost,
    };
  });

  // Compensation phase settles to Skipped (ok) or Failed (compensate failed)
  if (settledDispatch.phase === 'compensate') {
    const updatedTask: Task = {
      ...targetTask,
      dispatches,
      status: result.success ? TaskStatus.Skipped : TaskStatus.Failed,
      error: result.success
        ? (targetTask.error ?? 'compensated after failure')
        : (result.error ?? 'compensation failed'),
      completedAt: new Date().toISOString(),
      ...(result.success ? { result: result.output } : {}),
    };
    let nextRun: Run = {
      ...run,
      tasks: {
        ...run.tasks,
        [targetStepId]: updatedTask,
      },
    };
    if (!result.success) {
      nextRun = skipUnreachableTasks(nextRun, workflow);
    }
    return { run: nextRun };
  }

  const failedAttempts = dispatches.filter(
    (d) => d.phase !== 'compensate' && d.status === DispatchStatus.Failed,
  ).length;
  const retryLimit = resolveRetryLimit(step, defaults);
  const onFailure = resolveOnFailure(step, defaults);

  if (result.success) {
    const updatedTask: Task = {
      ...targetTask,
      dispatches,
      status: TaskStatus.Completed,
      result: result.output,
      completedAt: new Date().toISOString(),
    };
    return {
      run: {
        ...run,
        tasks: {
          ...run.tasks,
          [targetStepId]: updatedTask,
        },
      },
    };
  }

  // Still within retry budget → Pending for another attempt
  if (failedAttempts < retryLimit) {
    const updatedTask: Task = {
      ...targetTask,
      dispatches,
      status: TaskStatus.Pending,
      error: result.error,
    };
    return {
      run: {
        ...run,
        tasks: {
          ...run.tasks,
          [targetStepId]: updatedTask,
        },
      },
    };
  }

  // Exhausted retries → apply failback policy
  if (onFailure === 'skip') {
    const updatedTask: Task = {
      ...targetTask,
      dispatches,
      status: TaskStatus.Skipped,
      error: result.error ?? 'skipped after retries exhausted',
      completedAt: new Date().toISOString(),
    };
    return {
      run: {
        ...run,
        tasks: {
          ...run.tasks,
          [targetStepId]: updatedTask,
        },
      },
    };
  }

  if (onFailure === 'compensate' && step?.compensation?.run) {
    const updatedTask: Task = {
      ...targetTask,
      dispatches,
      status: TaskStatus.InProgress,
      error: result.error,
    };
    return {
      run: {
        ...run,
        tasks: {
          ...run.tasks,
          [targetStepId]: updatedTask,
        },
      },
      pendingCompensation: {
        stepId: targetStepId,
        compensation: step.compensation,
        ...(result.error ? { originalError: result.error } : {}),
      },
    };
  }

  // fail (default) — also when compensate requested without compensation payload
  const updatedTask: Task = {
    ...targetTask,
    dispatches,
    status: TaskStatus.Failed,
    error: result.error,
    completedAt: new Date().toISOString(),
  };
  const nextRun: Run = skipUnreachableTasks({
    ...run,
    tasks: {
      ...run.tasks,
      [targetStepId]: updatedTask,
    },
  }, workflow);
  return { run: nextRun };
}

/** Allocate a compensation dispatch on an in-progress failed task. */
export function dispatchCompensation(
  run: Run,
  stepId: string,
): { run: Run; dispatchId: string } {
  const task = run.tasks[stepId];
  if (!task) throw new Error(`Task not found: ${stepId}`);
  if (task.status !== TaskStatus.InProgress) {
    throw new Error(`Task ${stepId} is not in progress for compensation`);
  }

  const dispatchId = `dispatch-compensate-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const dispatch: Dispatch = {
    id: dispatchId,
    stepId,
    status: DispatchStatus.Queued,
    attempt: task.dispatches.length + 1,
    phase: 'compensate',
    startedAt: new Date().toISOString(),
  };

  return {
    run: {
      ...run,
      tasks: {
        ...run.tasks,
        [stepId]: {
          ...task,
          dispatches: [...task.dispatches, dispatch],
        },
      },
    },
    dispatchId,
  };
}

// ============================================================================
// Gate Operations
// ============================================================================

export function createGate(run: Run, workflow: Workflow, stepId: string): { run: Run; gate: Gate } {
  const step = findStep(workflow, stepId);
  if (!step) {
    throw new Error(`Step not found: ${stepId}`);
  }
  const gate = buildApprovalGate(step);

  return {
    run: {
      ...run,
      gates: {
        ...run.gates,
        [stepId]: gate,
      },
    },
    gate,
  };
}

/** Build an approval gate document from a workflow step definition. */
export function buildApprovalGate(step: Step): Gate {
  if (step.type !== StepType.Approval) {
    throw new Error(`Step ${step.id} is not an approval step`);
  }

  const options = step.options ?? ['approved', 'rejected'];
  return {
    id: `gate-${step.id}`,
    stepId: step.id,
    kind: 'approval',
    question: step.question ?? 'Approve?',
    options,
    pass: resolveGatePassDecisions(options, step.pass),
    token: randomUUID(),
  };
}

/** True when an open collab_peer slot must wait for a join before dispatch. */
export function collabPeerNeedsJoinGate(step: Step): boolean {
  return step.type === StepType.CollabPeer
    && !!step.peer
    && step.peer.open !== false
    && !step.peer.jid;
}

/** Build a collab join gate for an open, unbound collab_peer step. */
export function buildCollabJoinGate(step: Step): Gate {
  if (step.type !== StepType.CollabPeer) {
    throw new Error(`Step ${step.id} is not a collab_peer step`);
  }
  if (!step.peer) {
    throw new Error(`Step ${step.id} is missing peer`);
  }

  const slot = step.peer.slot ?? step.id;
  return {
    id: `gate-${step.id}`,
    stepId: step.id,
    kind: 'collab_join',
    question: `Waiting for peer join (slot=${slot})`,
    options: ['joined'],
    pass: ['joined'],
    token: randomUUID(),
  };
}

/**
 * Decisions that complete an approval gate.
 * Prefer explicit `pass`; else `approved` when listed; else the first option.
 */
export function resolveGatePassDecisions(
  options: readonly string[],
  pass?: readonly string[],
): string[] {
  if (pass && pass.length > 0) {
    return [...pass]
  }
  if (options.includes('approved')) return ['approved']
  if (options[0]) return [options[0]]
  return ['approved']
}

/** Whether a gate decision should mark the approval task completed. */
export function isGatePass(
  gate: Pick<Gate, 'options' | 'pass'>,
  decision: string,
): boolean {
  const pass = resolveGatePassDecisions(gate.options, gate.pass)
  return pass.includes(decision)
}

/**
 * Single source of truth for gate resolution (live coordinator + offline paths).
 * A failing decision cascades `skipUnreachableTasks` when `workflow` is provided.
 */
export function resolveGate(
  run: Run,
  stepId: string,
  decision: string,
  resolvedBy: string,
  token: string,
  options?: { workflow?: Workflow },
): Run {
  const gate = run.gates[stepId];
  if (!gate) {
    throw new Error(`Gate not found: ${stepId}`);
  }

  if (gate.token !== token) {
    throw new Error('Invalid gate token');
  }

  if (gate.resolved) {
    throw new Error(`Gate ${stepId} already resolved`);
  }

  const updatedGate: Gate = {
    ...gate,
    resolved: decision,
    resolvedBy,
    resolvedAt: new Date().toISOString(),
  };

  const task = run.tasks[stepId];
  const passed = isGatePass(gate, decision);
  const newTaskStatus = passed
    ? TaskStatus.Completed
    : TaskStatus.Failed;

  const updated: Run = {
    ...run,
    gates: {
      ...run.gates,
      [stepId]: updatedGate,
    },
    tasks: {
      ...run.tasks,
      [stepId]: {
        ...task,
        status: newTaskStatus,
        result: decision,
        completedAt: new Date().toISOString(),
      },
    },
  };

  if (!passed && options?.workflow) {
    return skipUnreachableTasks(updated, options.workflow);
  }
  return updated;
}

/**
 * Resolve a collab join gate without completing the step task.
 * The coordinator can dispatch runCollabPeer once the gate is resolved.
 */
export function resolveCollabJoinGate(
  run: Run,
  stepId: string,
  token: string,
  resolvedBy: string,
): Run {
  const gate = run.gates[stepId];
  if (!gate) {
    throw new Error(`Gate not found: ${stepId}`);
  }

  if (gate.kind !== 'collab_join') {
    throw new Error(`Gate ${stepId} is not a collab join gate`);
  }

  if (gate.token !== token) {
    throw new Error('Invalid gate token');
  }

  if (gate.resolved) {
    throw new Error(`Gate ${stepId} already resolved`);
  }

  const updatedGate: Gate = {
    ...gate,
    resolved: 'joined',
    resolvedBy,
    resolvedAt: new Date().toISOString(),
  };

  return {
    ...run,
    gates: {
      ...run.gates,
      [stepId]: updatedGate,
    },
  };
}

// ============================================================================
// Abort & Compensation
// ============================================================================

export function markAborted(run: Run, reason?: string): Run {
  const now = new Date().toISOString();
  const tasks: Record<string, Task> = {};

  for (const [stepId, task] of Object.entries(run.tasks)) {
    if (task.status === TaskStatus.InProgress || task.status === TaskStatus.Pending) {
      tasks[stepId] = {
        ...task,
        status: TaskStatus.Skipped,
        completedAt: now,
      };
    } else {
      tasks[stepId] = task;
    }
  }

  return {
    ...run,
    status: WorkflowStatus.Aborted,
    tasks,
    completedAt: now,
    error: reason,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function findStep(workflow: Workflow, stepId: string): Step | undefined {
  return workflow.spec.steps.find((step) => step.id === stepId);
}

export function isRunComplete(run: Run): boolean {
  return Object.values(run.tasks).every(
    t =>
      t.status === TaskStatus.Completed ||
      t.status === TaskStatus.Failed ||
      t.status === TaskStatus.Skipped,
  );
}

export function getRunProgress(run: Run): { total: number; completed: number; failed: number } {
  const tasks = Object.values(run.tasks);
  return {
    total: tasks.length,
    completed: tasks.filter(t => t.status === TaskStatus.Completed).length,
    failed: tasks.filter(t => t.status === TaskStatus.Failed).length,
  };
}
