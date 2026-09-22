/**
 * Workflow Coordinator
 * TypeScript rewrite of workflow-wise coordinator/loop.ts
 * Event-driven tick loop for dispatching tasks within concurrency budgets
 */

import { EventEmitter } from 'node:events';
import type {
  Workflow,
  Run,
  ExecutionContext,
  StepResult,
  Executor,
  Step,
} from './models.js';
import {
  WorkflowStatus,
  TaskStatus,
  StepType,
  DispatchStatus,
} from './models.js';
import {
  createRun,
  computeReady,
  dispatchTask,
  dispatchCompensation,
  settleDispatch,
  transitionWorkflow,
  isRunComplete,
  markAborted,
  resolveGate,
  resolveEffectiveConcurrency,
  DEFAULT_FAILURE_POLICY,
  type FailurePolicyDefaults,
} from './engine.js';
import { extractSharedPatch, mergeSharedVision } from './shared-vision.js';

// ============================================================================
// Types
// ============================================================================

export interface TickStats {
  ticks: number;
  dispatches: number;
  settlements: number;
  errors: number;
}

/**
 * First string-valued param among `keys`, in priority order.
 * Used to map run params onto well-known env vars (PROMPT / PROBLEM).
 */
export function pickParam(
  params: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | undefined {
  if (!params) return undefined;
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

/** Env vars derived from run params for script/LLM steps. */
export function buildStepEnv(params: Record<string, unknown> | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  const workspaceRoot = params?.workspaceRoot;
  if (typeof workspaceRoot === 'string') env.WORKSPACE_ROOT = workspaceRoot;
  const sessionId = params?.sessionId;
  if (typeof sessionId === 'string') env.SESSION_ID = sessionId;
  const prompt = pickParam(params, ['PROMPT', 'prompt']);
  if (prompt !== undefined) env.PROMPT = prompt;
  const problem = pickParam(params, ['PROBLEM', 'problem', 'QUESTION', 'question', 'PROMPT', 'prompt']);
  if (problem !== undefined) env.PROBLEM = problem;
  return env;
}

export interface CoordinatorOptions {
  maxConcurrency: number;
  tickInterval: number;  // ms
  heartbeatTimeout: number;  // ms — absolute stall ceiling when step has no timeout
  failurePolicy: FailurePolicyDefaults;
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
  /** Typed event contract — see {@link CoordinatorEvents}. */
  override on<K extends keyof CoordinatorEvents>(
    event: K,
    listener: CoordinatorEvents[K],
  ): this {
    return super.on(event, listener as (...args: any[]) => void);
  }

  override emit<K extends keyof CoordinatorEvents>(
    event: K,
    ...args: Parameters<CoordinatorEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  private state: CoordinatorState | null = null;
  private options: CoordinatorOptions;
  private stats: TickStats = { ticks: 0, dispatches: 0, settlements: 0, errors: 0 };
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  /** Run-level shared vision blackboard. */
  private shared: Record<string, unknown> = {};

  constructor(options: Partial<CoordinatorOptions> = {}) {
    super();
    this.options = {
      maxConcurrency: options.maxConcurrency ?? 4,
      tickInterval: options.tickInterval ?? 1000,
      heartbeatTimeout: options.heartbeatTimeout ?? 900_000,
      failurePolicy: options.failurePolicy ?? { ...DEFAULT_FAILURE_POLICY },
    };
  }

  /** Update global failure defaults (retries / on_failure) for subsequent settles. */
  setFailurePolicy(policy: Partial<FailurePolicyDefaults>): void {
    this.options.failurePolicy = {
      ...this.options.failurePolicy,
      ...policy,
    };
  }

  /**
   * Initialize the coordinator with a run
   */
  async init(
    workflow: Workflow,
    executor: Executor,
    params?: Record<string, unknown>,
    lineage?: { parentRunId?: string; rootRunId?: string; coordinatorId?: string },
  ): Promise<Run> {
    if (typeof workflow.spec.max_concurrency === 'number' && workflow.spec.max_concurrency > 0) {
      this.options.maxConcurrency = workflow.spec.max_concurrency
    }
    const run = createRun(
      workflow,
      params,
      lineage?.coordinatorId ?? `coord-${Date.now().toString(36)}`,
      {
        ...(lineage?.parentRunId ? { parentRunId: lineage.parentRunId } : {}),
        ...(lineage?.rootRunId ? { rootRunId: lineage.rootRunId } : {}),
      },
    );
    this.state = { run, workflow, executor };
    this.stats = { ticks: 0, dispatches: 0, settlements: 0, errors: 0 };
    this.shared = {};
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
    this.shared = { ...(run.shared ?? {}) };
  }

  /** Prevent overlapping async ticks from double-dispatching. */
  private ticking = false;
  private tickPending = false;

  /**
   * Start the tick loop
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.tickTimer = setInterval(() => {
      void this.safeTick();
    }, this.options.tickInterval);
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
    this.tickPending = false;
  }

  /** Serialize ticks so interval callbacks cannot overlap. */
  private async safeTick(): Promise<void> {
    if (this.ticking) {
      this.tickPending = true;
      return;
    }
    this.ticking = true;
    try {
      do {
        this.tickPending = false;
        if (!this.running || !this.state) break;
        await this.tick();
      } while (this.tickPending && this.running);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Abort in-flight dispatches, stop the tick loop, and mark the live run aborted.
   */
  async abortRun(reason?: string): Promise<Run | null> {
    if (!this.state) return null;

    const { run, executor } = this.state;
    const abortIds: string[] = [];
    for (const task of Object.values(run.tasks)) {
      for (const dispatch of task.dispatches) {
        if (
          dispatch.status === DispatchStatus.Queued
          || dispatch.status === DispatchStatus.Running
        ) {
          abortIds.push(dispatch.id);
        }
      }
    }

    await Promise.all(abortIds.map(async (dispatchId) => {
      try {
        await executor.abort(dispatchId);
      } catch {
        // Best-effort: continue marking the run aborted even if one abort fails.
      }
    }));

    this.stop();
    const updated = markAborted(run, reason);
    this.state = { ...this.state, run: updated };
    return updated;
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
      const concurrencyLimit = resolveEffectiveConcurrency(
        this.state.workflow,
        this.options.maxConcurrency,
      );
      const availableSlots = concurrencyLimit - runningCount;

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
            concurrencyLimit,
          );
          this.state.run = updatedRun;
          this.stats.dispatches++;

          this.emit('task:dispatch', stepId, dispatchId);

          const stepOutputs: Record<string, unknown> = {}
          for (const depId of step.deps ?? []) {
            const depTask = this.state.run.tasks[depId]
            if (depTask?.result !== undefined) {
              stepOutputs[depId] = depTask.result
              continue
            }
            const succeeded = depTask?.dispatches
              .slice()
              .reverse()
              .find(dispatch => dispatch.status === 'succeeded' && dispatch.result !== undefined)
            if (succeeded?.result !== undefined) stepOutputs[depId] = succeeded.result
          }

          const context: ExecutionContext = {
            runId: this.state.run.id,
            workflow: this.state.workflow,
            stateDir: '.',
            env: buildStepEnv(this.state.run.params),
            params: this.state.run.params,
            ...(Object.keys(stepOutputs).length > 0 ? { stepOutputs } : {}),
            ...(Object.keys(this.shared).length > 0 ? { shared: { ...this.shared } } : {}),
          }

          this.state.executor.submit(dispatchId, step, context).catch(error => {
            this.emit('error', error)
          })
        } catch (error) {
          this.stats.errors++;
          this.emit('error', error instanceof Error ? error : new Error(String(error)));
        }
      }

      // 3. Poll for completed dispatches (fail only past per-step timeout / stall ceiling)
      for (const [stepId, task] of Object.entries(this.state.run.tasks)) {
        if (task.status !== TaskStatus.InProgress) continue;
        const step = this.state.workflow.spec.steps.find((s) => s.id === stepId);

        for (const dispatch of task.dispatches) {
          if (dispatch.status !== 'queued' && dispatch.status !== 'running') continue;

          try {
            const startedMs = dispatch.startedAt ? Date.parse(dispatch.startedAt) : NaN;
            const limitMs = resolveDispatchTimeLimitMs(step, this.options.heartbeatTimeout);
            const hung = Number.isFinite(startedMs)
              && (Date.now() - startedMs) > limitMs;

            if (hung) {
              try {
                await this.state.executor.abort(dispatch.id);
              } catch {
                // continue settling as timeout failure
              }
              const result: StepResult = {
                success: false,
                error: `dispatch timeout after ${limitMs}ms`,
              };
              const settlement = settleDispatch(this.state.run, dispatch.id, result, {
                workflow: this.state.workflow,
                defaults: this.options.failurePolicy,
              });
              this.state.run = settlement.run;
              this.stats.settlements++;
              this.emit('task:settle', stepId, dispatch.id, result);
              continue;
            }

            const updatedDispatch = await this.state.executor.poll(dispatch.id);

            if (updatedDispatch.status === 'succeeded' || updatedDispatch.status === 'failed') {
              const result: StepResult = {
                success: updatedDispatch.status === 'succeeded',
                output: updatedDispatch.result,
                error: updatedDispatch.error,
                cost: updatedDispatch.cost,
              };

              const settlement = settleDispatch(this.state.run, dispatch.id, result, {
                workflow: this.state.workflow,
                defaults: this.options.failurePolicy,
              });
              this.state.run = settlement.run;
              this.stats.settlements++;

              if (settlement.pendingCompensation) {
                const { stepId: compensateStepId, compensation } = settlement.pendingCompensation;
                try {
                  const { run: withDispatch, dispatchId: compensateId } = dispatchCompensation(
                    this.state.run,
                    compensateStepId,
                  );
                  this.state.run = withDispatch;
                  const compensateStep: Step = {
                    id: compensateStepId,
                    type: StepType.Script,
                    run: compensation.run,
                    ...(compensation.env ? { env: compensation.env } : {}),
                  };
                  const compensateContext: ExecutionContext = {
                    runId: this.state.run.id,
                    workflow: this.state.workflow,
                    stateDir: '.',
                    env: {
                      ...buildStepEnv(this.state.run.params),
                      ...(compensation.env ?? {}),
                    },
                    params: this.state.run.params,
                  };
                  this.emit('task:dispatch', compensateStepId, compensateId);
                  this.state.executor.submit(compensateId, compensateStep, compensateContext).catch((error) => {
                    this.emit('error', error);
                  });
                } catch (error) {
                  this.stats.errors++;
                  this.emit('error', error instanceof Error ? error : new Error(String(error)));
                }
              }

              if (result.success) {
                const patch = extractSharedPatch(result.output)
                if (patch) {
                  this.shared = mergeSharedVision(this.shared, patch)
                  this.state.run = {
                    ...this.state.run,
                    shared: { ...this.shared },
                  }
                }
              }

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
   * Resolve an approval gate (delegates to engine.resolveGate).
   */
  resolveGate(stepId: string, decision: string, resolvedBy: string, token: string): void {
    if (!this.state) {
      throw new Error('Coordinator not initialized');
    }

    this.state.run = resolveGate(this.state.run, stepId, decision, resolvedBy, token, {
      workflow: this.state.workflow,
    });
  }
}

/** Per-dispatch wall-clock limit: step.timeout, else script default 600s, else heartbeat ceiling. */
export function resolveDispatchTimeLimitMs(
  step: Step | undefined,
  heartbeatTimeoutMs: number,
): number {
  if (typeof step?.timeout === 'number' && step.timeout > 0) {
    return step.timeout * 1000
  }
  if (step?.type === StepType.Script) {
    return 600_000
  }
  return Math.max(1, heartbeatTimeoutMs)
}
