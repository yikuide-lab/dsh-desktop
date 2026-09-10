/**
 * Workflow Store
 * File-based persistence for workflows and runs
 */

import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  unlink,
  stat,
} from 'node:fs/promises';
import { join } from 'node:path';
import type { Workflow, WorkflowState, Run } from './models.ts';

// ============================================================================
// Store
// ============================================================================

export class WorkflowStore {
  private stateDir: string;

  constructor(stateDir: string) {
    this.stateDir = stateDir;
  }

  /**
   * Initialize the store directories
   */
  async init(): Promise<void> {
    await mkdir(join(this.stateDir, 'workflows'), { recursive: true });
    await mkdir(join(this.stateDir, 'runs'), { recursive: true });
  }

  // ==========================================================================
  // Workflow Operations
  // ==========================================================================

  /**
   * Save a workflow definition
   */
  async saveWorkflow(workflow: Workflow): Promise<WorkflowState> {
    const name = workflow.metadata.name;
    const now = new Date().toISOString();

    const state: WorkflowState = {
      workflow,
      status: workflow.apiVersion ? 'approved' : 'draft',
      createdAt: now,
      updatedAt: now,
    };

    const path = join(this.stateDir, 'workflows', `${name}.json`);
    await writeFile(path, JSON.stringify(state, null, 2), 'utf-8');

    return state;
  }

  /**
   * Load a workflow by name
   */
  async loadWorkflow(name: string): Promise<WorkflowState | null> {
    const path = join(this.stateDir, 'workflows', `${name}.json`);
    try {
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content) as WorkflowState;
    } catch {
      return null;
    }
  }

  /**
   * List all workflows
   */
  async listWorkflows(): Promise<WorkflowState[]> {
    const dir = join(this.stateDir, 'workflows');
    try {
      const files = await readdir(dir);
      const workflows: WorkflowState[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const content = await readFile(join(dir, file), 'utf-8');
        workflows.push(JSON.parse(content) as WorkflowState);
      }

      return workflows;
    } catch {
      return [];
    }
  }

  /**
   * Delete a workflow
   */
  async deleteWorkflow(name: string): Promise<boolean> {
    const path = join(this.stateDir, 'workflows', `${name}.json`);
    try {
      await unlink(path);
      return true;
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // Run Operations
  // ==========================================================================

  /**
   * Save a run
   */
  async saveRun(run: Run): Promise<void> {
    const path = join(this.stateDir, 'runs', `${run.id}.json`);
    await writeFile(path, JSON.stringify(run, null, 2), 'utf-8');
  }

  /**
   * Load a run by ID
   */
  async loadRun(runId: string): Promise<Run | null> {
    const path = join(this.stateDir, 'runs', `${runId}.json`);
    try {
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content) as Run;
    } catch {
      return null;
    }
  }

  /**
   * List all runs for a workflow
   */
  async listRuns(workflowName?: string): Promise<Run[]> {
    const dir = join(this.stateDir, 'runs');
    try {
      const files = await readdir(dir);
      const runs: Run[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const content = await readFile(join(dir, file), 'utf-8');
        const run = JSON.parse(content) as Run;

        if (!workflowName || run.workflowName === workflowName) {
          runs.push(run);
        }
      }

      return runs.sort((a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      );
    } catch {
      return [];
    }
  }

  /**
   * Update a run atomically
   */
  async updateRun(runId: string, updater: (run: Run) => Run): Promise<Run> {
    const run = await this.loadRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    const updated = updater(run);
    await this.saveRun(updated);
    return updated;
  }

  /**
   * Delete a run
   */
  async deleteRun(runId: string): Promise<boolean> {
    const path = join(this.stateDir, 'runs', `${runId}.json`);
    try {
      await unlink(path);
      return true;
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get workflow statistics
   */
  async getStats(workflowName: string): Promise<{
    totalRuns: number;
    completed: number;
    failed: number;
    running: number;
  }> {
    const runs = await this.listRuns(workflowName);
    return {
      totalRuns: runs.length,
      completed: runs.filter(r => r.status === 'completed').length,
      failed: runs.filter(r => r.status === 'failed').length,
      running: runs.filter(r => r.status === 'running').length,
    };
  }
}
