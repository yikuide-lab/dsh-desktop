/**
 * Workflow Coordinator
 * TypeScript rewrite of workflow-wise coordinator/loop.ts
 * Event-driven tick loop for dispatching tasks within concurrency budgets
 */

import { EventEmitter } from 'node:events';
import type {
  Workflow,
  Run,
  Step,
  ExecutionContext,
  StepResult,
  Executor,
} from './models.ts';
import {
  WorkflowStatus,
  TaskStatus,
  StepType,
} from './models.ts';
import {
  createRun,
  computeReady,
  dispatchTask,
  settleDispatch,
  transitionWorkflow,
  isRunComplete,
} from './engine.ts';

// ============================================================================
// Types
// ============================================================================

export interface TickStats {
  ticks: number;
  dispatches: number;
  settlements: number;
  errors: number;
}

export interface CoordinatorOptions {
  maxConcurrency: number;
  tickInterval: number;  // ms
  heartbeatTimeout: number;  // ms
}

export interface CoordinatorState {
  run: Run;
  workflow: Workflow;
  executor: Executor;
}

// ============================================================================
// Events
// ============================================================================

export interface CoordinatorEvents {
  'tick:start': (stats: TickStats) => void;
  'tick:end': (stats: TickStats) => void;
  'task:dispatch': (stepId: string, dispatchId: string) => void;
  'task:settle': (stepId: string, dispatchId: string, result: StepResult) => void;
  'run:complete': (run: Run) => void;
  'run:fail': (run: Run, error: Error) => void;
  'error': (error: Error) => void;
}

// ============================================================================
// Coordinator
// ============================================================================

export class Coordinator extends EventEmitter {
  private state: CoordinatorState | null = null;
  private options: CoordinatorOptions;
  private stats: TickStats = { ticks: 0, dispatches: 0, settlements: 0, errors: 0 };
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(options: Partial<CoordinatorOptions> = {}) {
    super();
    this.options = {
      maxConcurrency: options.maxConcurrency ?? 4,
      tickInterval: options.tickInterval ?? 1000,
      heartbeatTimeout: options.heartbeatTimeout ?? 30000,
    };
  }

  /**
   * Initialize the coordinator with a run
   */
  async init(
    workflow: Workflow,
    executor: Executor,
    params?: Record<string, unknown>,
  ): Promise<Run> {
    const run = createRun(workflow, params, 'coordinator-1');
    this.state = { run, workflow, executor };
    this.stats = { ticks: 0, dispatches: 0, settlements: 0, errors: 0 };
    return run;
  }

  /**
   * Resume from an existing run state
   */
  async resume(
    workflow: Workflow,
    run: Run,
    executor: Executor,
  ): Promise<void> {
    this.state = { run, workflow, executor };
  }

  /**
   * Start the tick loop
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.tickTimer = setInterval(() => this.tick(), this.options.tickInterval);
  }

  /**
   * Stop the tick loop
   */
  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.running = false;
  }

  /**
   * Single tick - main coordination logic
   */
  async tick(): Promise<TickStats> {
    if (!this.state) {
      throw new Error('Coordinator not initialized');
    }

    this.stats.ticks++;
    this.emit('tick:start', { ...this.stats });

    try {
      // 1. Compute ready tasks
      const readySteps = computeReady(this.state.run, this.state.workflow);

      // 2. Dispatch ready tasks within concurrency budget
      const runningCount = Object.values(this.state.run.tasks).filter(
        t => t.status === TaskStatus.InProgress,
      ).length;
      const availableSlots = this.options.maxConcurrency - runningCount;

      for (const stepId of readySteps.slice(0, availableSlots)) {
        const step = this.state.workflow.spec.steps.find(s => s.id === stepId);
        if (!step) continue;

        // Skip approval steps - they need manual resolution
        if (step.type === StepType.Approval) {
          const gate = this.state.run.gates[stepId];
          if (gate && !gate.resolved) {
            continue;  // wait for manual resolution
          }
        }

        try {
          const { run: updatedRun, dispatchId } = dispatchTask(
            this.state.run,
            stepId,
            this.options.maxConcurrency,
          );
          this.state.run = updatedRun;
          this.stats.dispatches++;

          this.emit('task:dispatch', stepId, dispatchId);

          // Submit to executor
          const context: ExecutionContext = {
            runId: this.state.run.id,
            workflow: this.state.workflow,
            stateDir: '.',
          };

          this.state.executor.submit(step, context).catch(error => {
            this.emit('error', error);
          });
        } catch (error) {
          this.stats.errors++;
          this.emit('error', error instanceof Error ? error : new Error(String(error)));
        }
      }

      // 3. Poll for completed dispatches
      for (const [stepId, task] of Object.entries(this.state.run.tasks)) {
        if (task.status !== TaskStatus.InProgress) continue;

        for (const dispatch of task.dispatches) {
          if (dispatch.status !== 'queued' && dispatch.status !== 'running') continue;

          try {
            const updatedDispatch = await this.state.executor.poll(dispatch.id);

            if (updatedDispatch.status === 'succeeded' || updatedDispatch.status === 'failed') {
              const result: StepResult = {
                success: updatedDispatch.status === 'succeeded',
                output: updatedDispatch.result,
                error: updatedDispatch.error,
                cost: updatedDispatch.cost,
              };

              this.state.run = settleDispatch(this.state.run, dispatch.id, result);
              this.stats.settlements++;

              this.emit('task:settle', stepId, dispatch.id, result);
            }
          } catch (error) {
            this.stats.errors++;
            this.emit('error', error instanceof Error ? error : new Error(String(error)));
          }
        }
      }

      // 4. Check if run is complete
      if (isRunComplete(this.state.run)) {
        const hasFailures = Object.values(this.state.run.tasks).some(
          t => t.status === TaskStatus.Failed,
        );

        this.state.run = transitionWorkflow(
          this.state.run,
          hasFailures ? WorkflowStatus.Failed : WorkflowStatus.Completed,
        );

        this.stop();
        this.emit(hasFailures ? 'run:fail' : 'run:complete', this.state.run);
      }
    } catch (error) {
      this.stats.errors++;
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }

    this.emit('tick:end', { ...this.stats });
    return { ...this.stats };
  }

  /**
   * Run until no more tasks can be dispatched
   */
  async runUntilIdle(): Promise<Run> {
    if (!this.state) {
      throw new Error('Coordinator not initialized');
    }

    let previousStats = { ...this.stats };
    let stableCount = 0;

    while (stableCount < 3) {
      await this.tick();

      if (
        this.stats.dispatches === previousStats.dispatches &&
        this.stats.settlements === previousStats.settlements
      ) {
        stableCount++;
      } else {
        stableCount = 0;
        previousStats = { ...this.stats };
      }

      if (isRunComplete(this.state.run)) break;
    }

    return this.state.run;
  }

  /**
   * Get current run state
   */
  getRun(): Run | null {
    return this.state?.run ?? null;
  }

  /**
   * Get statistics
   */
  getStats(): TickStats {
    return { ...this.stats };
  }

  /**
   * Resolve an approval gate
   */
  resolveGate(stepId: string, decision: string, resolvedBy: string, token: string): void {
    if (!this.state) {
      throw new Error('Coordinator not initialized');
    }

    const gate = this.state.run.gates[stepId];
    if (!gate) {
      throw new Error(`Gate not found: ${stepId}`);
    }

    if (gate.token !== token) {
      throw new Error('Invalid gate token');
    }

    // Update gate and task status
    this.state.run = {
      ...this.state.run,
      gates: {
        ...this.state.run.gates,
        [stepId]: {
          ...gate,
          resolved: decision,
          resolvedBy,
          resolvedAt: new Date().toISOString(),
        },
      },
      tasks: {
        ...this.state.run.tasks,
        [stepId]: {
          ...this.state.run.tasks[stepId],
          status: decision === 'approved' ? TaskStatus.Completed : TaskStatus.Failed,
          result: decision,
          completedAt: new Date().toISOString(),
        },
      },
    };
  }
}
