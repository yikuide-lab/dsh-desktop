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
  type ExecutionContext,
  type StepResult,
  WorkflowStatus,
  TaskStatus,
  DispatchStatus,
  StepType,
} from './models.ts';

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
      gates[step.id] = {
        id: `gate-${step.id}`,
        stepId: step.id,
        question: step.question ?? 'Approve?',
        options: step.options ?? ['approved', 'rejected'],
        token: randomUUID(),
      };
    }
  }

  return {
    id: runId,
    workflowName: workflow.metadata.name,
    status: WorkflowStatus.Running,
    params,
    tasks,
    gates,
    startedAt: new Date().toISOString(),
    coordinatorId,
  };
}

// ============================================================================
// Ready Set Computation
// ============================================================================

/**
 * Compute the set of tasks that are ready to execute.
 * A task is ready when:
 * 1. Its status is Pending
 * 2. All dependencies are completed
 */
export function computeReady(run: Run, workflow: Workflow): string[] {
  const ready: string[] = [];

  for (const step of workflow.spec.steps) {
    const task = run.tasks[step.id];
    if (!task || task.status !== TaskStatus.Pending) continue;

    // Check if all dependencies are completed
    const deps = step.deps ?? [];
    const allDepsCompleted = deps.every(depId => {
      const depTask = run.tasks[depId];
      return depTask?.status === TaskStatus.Completed;
    });

    if (allDepsCompleted) {
      ready.push(step.id);
    }
  }

  return ready;
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

  const dispatchId = `dispatch-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const dispatch: Dispatch = {
    id: dispatchId,
    stepId,
    status: DispatchStatus.Queued,
    attempt: 1,
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

const CIRCUIT_BREAKER_LIMIT = 3;

export function settleDispatch(
  run: Run,
  dispatchId: string,
  result: StepResult,
): Run {
  // Find the task containing this dispatch
  let targetTask: Task | undefined;
  let targetStepId: string | undefined;

  for (const [stepId, task] of Object.entries(run.tasks)) {
    const dispatch = task.dispatches.find(d => d.id === dispatchId);
    if (dispatch) {
      targetTask = task;
      targetStepId = stepId;
      break;
    }
  }

  if (!targetTask || !targetStepId) {
    throw new Error(`Dispatch not found: ${dispatchId}`);
  }

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

  // Check circuit breaker
  const failedAttempts = dispatches.filter(d => d.status === DispatchStatus.Failed).length;
  const newStatus = result.success
    ? TaskStatus.Completed
    : failedAttempts >= CIRCUIT_BREAKER_LIMIT
      ? TaskStatus.Failed
      : TaskStatus.Pending;  // retry

  const updatedTask: Task = {
    ...targetTask,
    dispatches,
    status: newStatus,
    ...(result.success ? { result: result.output, completedAt: new Date().toISOString() } : {}),
    ...(!result.success && failedAttempts >= CIRCUIT_BREAKER_LIMIT
      ? { error: result.error, completedAt: new Date().toISOString() }
      : {}),
  };

  return {
    ...run,
    tasks: {
      ...run.tasks,
      [targetStepId]: updatedTask,
    },
  };
}

// ============================================================================
// Gate Operations
// ============================================================================

export function createGate(run: Run, stepId: string): { run: Run; gate: Gate } {
  const step = findStep(run, stepId);
  if (step?.type !== StepType.Approval) {
    throw new Error(`Step ${stepId} is not an approval step`);
  }

  const gate: Gate = {
    id: `gate-${stepId}`,
    stepId,
    question: step.question ?? 'Approve?',
    options: step.options ?? ['approved', 'rejected'],
    token: randomUUID(),
  };

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

export function resolveGate(
  run: Run,
  stepId: string,
  decision: string,
  resolvedBy: string,
  token: string,
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

  // Mark task as completed if approved, failed if rejected
  const task = run.tasks[stepId];
  const newTaskStatus = decision === 'approved'
    ? TaskStatus.Completed
    : TaskStatus.Failed;

  return {
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

function findStep(run: Run, stepId: string): Step | undefined {
  // This is a simplified lookup - in production, we'd pass the workflow
  return undefined;
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
