/**
 * DSH Workflow Plugin
 * Integrates workflow engine as a Cordis plugin for DSH Desktop
 */

import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { WorkflowStore } from './engine/store.ts';
import { Coordinator } from './engine/coordinator.ts';
import {
  parseWorkflow,
  validateWorkflow,
} from './engine/models.ts';
import type {
  Workflow,
  Run,
  Executor,
  StepResult,
  Step,
  ExecutionContext,
} from './engine/models.ts';
import { DispatchStatus } from './engine/models.ts';

// ============================================================================
// Plugin Configuration
// ============================================================================

export interface WorkflowPluginConfig {
  stateDir?: string;
  maxConcurrency?: number;
  tickInterval?: number;
}

// ============================================================================
// Plugin Implementation
// ============================================================================

export class WorkflowPlugin {
  private store: WorkflowStore;
  private coordinator: Coordinator;
  private config: Required<WorkflowPluginConfig>;

  constructor(config: WorkflowPluginConfig = {}) {
    this.config = {
      stateDir: config.stateDir ?? join(homedir(), '.dsh', 'workflow'),
      maxConcurrency: config.maxConcurrency ?? 4,
      tickInterval: config.tickInterval ?? 1000,
    };

    this.store = new WorkflowStore(this.config.stateDir);
    this.coordinator = new Coordinator({
      maxConcurrency: this.config.maxConcurrency,
      tickInterval: this.config.tickInterval,
    });
  }

  /**
   * Initialize the plugin
   */
  async init(): Promise<void> {
    await this.store.init();
    console.log(`[workflow] Initialized with state dir: ${this.config.stateDir}`);
  }

  // ==========================================================================
  // Workflow Management
  // ==========================================================================

  /**
   * Create a workflow from YAML
   */
  async createWorkflow(yaml: string): Promise<{ workflow: Workflow; validation: ReturnType<typeof validateWorkflow> }> {
    const workflow = parseWorkflow(yaml);
    const validation = validateWorkflow(workflow);

    if (validation.ok) {
      await this.store.saveWorkflow(workflow);
    }

    return { workflow, validation };
  }

  /**
   * Get a workflow by name
   */
  async getWorkflow(name: string): Promise<Workflow | null> {
    const state = await this.store.loadWorkflow(name);
    return state?.workflow ?? null;
  }

  /**
   * List all workflows
   */
  async listWorkflows(): Promise<Workflow[]> {
    const states = await this.store.listWorkflows();
    return states.map(s => s.workflow);
  }

  /**
   * Delete a workflow
   */
  async deleteWorkflow(name: string): Promise<boolean> {
    return this.store.deleteWorkflow(name);
  }

  // ==========================================================================
  // Run Management
  // ==========================================================================

  /**
   * Start a new run
   */
  async startRun(
    workflowName: string,
    params?: Record<string, unknown>,
  ): Promise<Run> {
    const workflow = await this.getWorkflow(workflowName);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowName}`);
    }

    const validation = validateWorkflow(workflow);
    if (!validation.ok) {
      throw new Error(`Workflow validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
    }

    const run = await this.coordinator.init(workflow, this.createDefaultExecutor(), params);
    await this.store.saveRun(run);

    // Start the coordinator
    this.coordinator.start();

    return run;
  }

  /**
   * Get a run by ID
   */
  async getRun(runId: string): Promise<Run | null> {
    return this.store.loadRun(runId);
  }

  /**
   * List runs for a workflow
   */
  async listRuns(workflowName?: string): Promise<Run[]> {
    return this.store.listRuns(workflowName);
  }

  /**
   * Stop a run
   */
  async stopRun(runId: string): Promise<Run> {
    const run = await this.store.updateRun(runId, r => ({
      ...r,
      status: 'aborted' as const,
      completedAt: new Date().toISOString(),
    }));

    this.coordinator.stop();
    return run;
  }

  /**
   * Resolve an approval gate
   */
  async resolveGate(
    runId: string,
    stepId: string,
    decision: string,
    resolvedBy: string,
    token: string,
  ): Promise<void> {
    const run = await this.store.loadRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    this.coordinator.resolveGate(stepId, decision, resolvedBy, token);
    const updatedRun = this.coordinator.getRun();
    if (updatedRun) {
      await this.store.saveRun(updatedRun);
    }
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get plugin statistics
   */
  async getStats(): Promise<{
    workflows: number;
    runs: { total: number; running: number; completed: number; failed: number };
    coordinator: ReturnType<Coordinator['getStats']>;
  }> {
    const workflows = await this.store.listWorkflows();
    const allRuns = await this.store.listRuns();

    return {
      workflows: workflows.length,
      runs: {
        total: allRuns.length,
        running: allRuns.filter(r => r.status === 'running').length,
        completed: allRuns.filter(r => r.status === 'completed').length,
        failed: allRuns.filter(r => r.status === 'failed').length,
      },
      coordinator: this.coordinator.getStats(),
    };
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Create a default executor (stub implementation)
   */
  private createDefaultExecutor(): Executor {
    return {
      async submit(step: Step, context: ExecutionContext): Promise<string> {
        console.log(`[workflow] Submitting step: ${step.id} (type: ${step.type})`);
        return `dispatch-${Date.now()}`;
      },

      async poll(dispatchId: string): Promise<{ id: string; stepId: string; status: DispatchStatus; attempt: number }> {
        return {
          id: dispatchId,
          stepId: '',
          status: DispatchStatus.Succeeded,
          attempt: 1,
        };
      },

      async abort(dispatchId: string): Promise<void> {
        console.log(`[workflow] Aborting dispatch: ${dispatchId}`);
      },
    };
  }
}

// ============================================================================
// Plugin Factory
// ============================================================================

export function createWorkflowPlugin(config?: WorkflowPluginConfig): WorkflowPlugin {
  return new WorkflowPlugin(config);
}

export default WorkflowPlugin;
