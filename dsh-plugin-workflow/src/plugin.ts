/**
 * DSH Workflow Plugin
 * Integrates workflow engine as a Cordis plugin for DSH Desktop
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { WorkflowStore } from './engine/store.ts';
import { Coordinator } from './engine/coordinator.ts';
import { TriggerManager } from './triggers/trigger.ts';
import { MCPServer } from './mcp/server.ts';
import type { TriggerConfig } from './triggers/trigger.ts';
import {
  parseWorkflow,
  validateWorkflow,
} from './engine/models.ts';
import type {
  Workflow,
  Run,
  Executor,
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
  mcpEnabled?: boolean;
  mcpPort?: number;
  triggersEnabled?: boolean;
}

// ============================================================================
// Plugin Implementation
// ============================================================================

export class WorkflowPlugin {
  private store: WorkflowStore;
  private coordinator: Coordinator;
  private triggerManager: TriggerManager;
  private mcpServer: MCPServer | null = null;
  private config: Required<WorkflowPluginConfig>;

  constructor(config: WorkflowPluginConfig = {}) {
    this.config = {
      stateDir: config.stateDir ?? join(homedir(), '.dsh', 'workflow'),
      maxConcurrency: config.maxConcurrency ?? 4,
      tickInterval: config.tickInterval ?? 1000,
      mcpEnabled: config.mcpEnabled ?? true,
      mcpPort: config.mcpPort ?? 18081,
      triggersEnabled: config.triggersEnabled ?? true,
    };

    this.store = new WorkflowStore(this.config.stateDir);
    this.coordinator = new Coordinator({
      maxConcurrency: this.config.maxConcurrency,
      tickInterval: this.config.tickInterval,
    });
    this.triggerManager = new TriggerManager((triggerConfig) => {
      this.handleTrigger(triggerConfig);
    });
  }

  /**
   * Initialize the plugin
   */
  async init(): Promise<void> {
    await this.store.init();

    // Start MCP server if enabled
    if (this.config.mcpEnabled) {
      this.mcpServer = new MCPServer(this);
      // Don't start stdio here - let the caller decide
      console.log(`[workflow] MCP server ready (stdio mode)`);
    }

    console.log(`[workflow] Initialized with state dir: ${this.config.stateDir}`);
  }

  /**
   * Start MCP server in stdio mode
   */
  async startMCP(): Promise<void> {
    if (this.mcpServer) {
      await this.mcpServer.startStdio();
    }
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
  // Trigger Management
  // ==========================================================================

  /**
   * Add a trigger
   */
  addTrigger(config: TriggerConfig): { id: string; config: TriggerConfig } {
    const record = this.triggerManager.add(config);
    return { id: record.id, config: record.config };
  }

  /**
   * Remove a trigger
   */
  removeTrigger(id: string): boolean {
    return this.triggerManager.remove(id);
  }

  /**
   * List all triggers
   */
  listTriggers(): Array<{ id: string; config: TriggerConfig; enabled: boolean; nextTrigger?: string }> {
    return this.triggerManager.list().map(r => ({
      id: r.id,
      config: r.config,
      enabled: r.enabled,
      nextTrigger: r.nextTrigger,
    }));
  }

  /**
   * Fire an event manually
   */
  fireEvent(source: string, name: string, data?: Record<string, unknown>): void {
    this.triggerManager.fireEvent({
      source,
      name,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle a trigger
   */
  private async handleTrigger(config: TriggerConfig): Promise<void> {
    try {
      await this.startRun(config.workflowName, config.params);
      console.log(`[workflow] Triggered workflow: ${config.workflowName}`);
    } catch (error) {
      console.error(`[workflow] Trigger failed:`, error);
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
    triggers: number;
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
      triggers: this.triggerManager.list().length,
      coordinator: this.coordinator.getStats(),
    };
  }

  /**
   * Stop the plugin
   */
  stop(): void {
    this.coordinator.stop();
    this.triggerManager.stop();
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
