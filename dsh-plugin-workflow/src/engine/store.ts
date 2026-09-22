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
  rename,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { Workflow, WorkflowState, Run } from './models.js';
import { RUN_SCHEMA_VERSION, WorkflowStatus } from './models.js';
import {
  appendTranscriptEvent,
  loadTranscriptEvents,
  type TranscriptEvent,
} from './transcript.js';

function normalizeRun(run: Run): Run {
  const version = run.schemaVersion ?? 1;
  if (version > RUN_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported run schemaVersion ${version} (max ${RUN_SCHEMA_VERSION}) for run ${run.id}`,
    );
  }
  return {
    ...run,
    schemaVersion: version,
  };
}

async function writeTextAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, contents, 'utf-8');
  await rename(tmp, path);
}

/** Allocate or reuse a stable workflow document uid. */
export function ensureWorkflowUid(workflow: Workflow): string {
  const existing = workflow.metadata.uid?.trim();
  if (existing) return existing;
  return randomUUID();
}

function withWorkflowUid(workflow: Workflow, uid: string): Workflow {
  return {
    ...workflow,
    metadata: {
      ...workflow.metadata,
      uid,
    },
  };
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

// ============================================================================
// Store
// ============================================================================

export class WorkflowStore {
  private stateDir: string;
  /** Serialize read-modify-write updates per run id. */
  private runChains = new Map<string, Promise<unknown>>();

  constructor(stateDir: string) {
    this.stateDir = stateDir;
  }

  getStateDir(): string {
    return this.stateDir;
  }

  /**
   * Initialize the store directories
   */
  async init(): Promise<void> {
    await mkdir(join(this.stateDir, 'workflows'), { recursive: true });
    await mkdir(join(this.stateDir, 'runs'), { recursive: true });
    await this.migrateWorkflowFiles();
  }

  private workflowsDir(): string {
    return join(this.stateDir, 'workflows');
  }

  private workflowPathByUid(uid: string): string {
    return join(this.workflowsDir(), `${uid}.json`);
  }

  private workflowPathByName(name: string): string {
    return join(this.workflowsDir(), `${name}.json`);
  }

  private async readStateFile(path: string): Promise<WorkflowState | null> {
    try {
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content) as WorkflowState;
    } catch {
      return null;
    }
  }

  /**
   * Rewrite legacy `{name}.json` files to `{uid}.json` and backfill missing uids.
   */
  private async migrateWorkflowFiles(): Promise<void> {
    let files: string[];
    try {
      files = await readdir(this.workflowsDir());
    } catch {
      return;
    }

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const path = join(this.workflowsDir(), file);
      const state = await this.readStateFile(path);
      if (!state?.workflow?.metadata?.name) continue;

      const uid = ensureWorkflowUid(state.workflow);
      const nextWorkflow = withWorkflowUid(state.workflow, uid);
      const target = this.workflowPathByUid(uid);
      const needsRewrite = !state.workflow.metadata.uid || path !== target;
      if (!needsRewrite) continue;

      const nextState: WorkflowState = {
        ...state,
        workflow: nextWorkflow,
      };
      await writeTextAtomic(target, JSON.stringify(nextState, null, 2));
      if (path !== target) {
        try {
          await unlink(path);
        } catch {
          // ignore
        }
      }
    }
  }

  private async withRunLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.runChains.get(runId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.catch(() => undefined).then(() => gate);
    this.runChains.set(runId, chained);
    await previous.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.runChains.get(runId) === chained) {
        this.runChains.delete(runId);
      }
    }
  }

  // ==========================================================================
  // Workflow Operations
  // ==========================================================================

  /**
   * Save a workflow definition keyed by metadata.uid (stable across renames).
   * When uid is omitted, reuse the existing document that already owns this name.
   */
  async saveWorkflow(workflow: Workflow): Promise<WorkflowState> {
    const all = await this.listWorkflowsRaw();
    const providedUid = workflow.metadata.uid?.trim();
    const byName = all.find((entry) => entry.workflow.metadata.name === workflow.metadata.name);
    const uid = providedUid
      || (byName ? ensureWorkflowUid(byName.workflow) : undefined)
      || randomUUID();
    const nextWorkflow = withWorkflowUid(workflow, uid);
    const now = new Date().toISOString();
    const existing = await this.loadWorkflowByUid(uid) ?? (byName && ensureWorkflowUid(byName.workflow) === uid
      ? byName
      : null);

    // Reject name collisions against a different uid.
    const collision = all.find((entry) => (
      entry.workflow.metadata.name === nextWorkflow.metadata.name
      && ensureWorkflowUid(entry.workflow) !== uid
    ));
    if (collision) {
      throw new Error(
        `Workflow name already in use by another document: ${nextWorkflow.metadata.name}`,
      );
    }

    const state: WorkflowState = {
      workflow: nextWorkflow,
      // Draft→Proposed→Reviewing→Approved lifecycle is modeled in WorkflowStatus
      // and VALID_TRANSITIONS but not yet exposed; saved docs are always Approved.
      status: WorkflowStatus.Approved,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await writeTextAtomic(this.workflowPathByUid(uid), JSON.stringify(state, null, 2));

    // Drop legacy name-keyed file when present (pre-uid storage).
    const legacy = this.workflowPathByName(nextWorkflow.metadata.name);
    if (legacy !== this.workflowPathByUid(uid)) {
      try {
        const legacyState = await this.readStateFile(legacy);
        if (legacyState && ensureWorkflowUid(legacyState.workflow) === uid) {
          await unlink(legacy);
        }
      } catch {
        // ignore
      }
    }

    // If renamed, also remove a stale legacy file for the previous name.
    if (existing && existing.workflow.metadata.name !== nextWorkflow.metadata.name) {
      const previousLegacy = this.workflowPathByName(existing.workflow.metadata.name);
      try {
        const previousState = await this.readStateFile(previousLegacy);
        if (previousState && ensureWorkflowUid(previousState.workflow) === uid) {
          await unlink(previousLegacy);
        }
      } catch {
        // ignore
      }
    }

    return state;
  }

  private async loadWorkflowByUid(uid: string): Promise<WorkflowState | null> {
    return this.readStateFile(this.workflowPathByUid(uid));
  }

  /**
   * Load a workflow by uid or by human-readable name.
   */
  async loadWorkflow(nameOrUid: string): Promise<WorkflowState | null> {
    const key = nameOrUid.trim();
    if (!key) return null;

    if (isUuidLike(key)) {
      const byUid = await this.loadWorkflowByUid(key);
      if (byUid) return byUid;
    }

    const byNameFile = await this.readStateFile(this.workflowPathByName(key));
    if (byNameFile) {
      // Opportunistically migrate legacy name-keyed files.
      if (!byNameFile.workflow.metadata.uid) {
        return this.saveWorkflow(byNameFile.workflow);
      }
      return byNameFile;
    }

    const all = await this.listWorkflowsRaw();
    return all.find((entry) => entry.workflow.metadata.name === key) ?? null;
  }

  private async listWorkflowsRaw(): Promise<WorkflowState[]> {
    const dir = this.workflowsDir();
    try {
      const files = await readdir(dir);
      const workflows: WorkflowState[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const state = await this.readStateFile(join(dir, file));
        if (state?.workflow) workflows.push(state);
      }
      return workflows;
    } catch {
      return [];
    }
  }

  /**
   * List all workflows (migrates legacy files as needed).
   */
  async listWorkflows(): Promise<WorkflowState[]> {
    await this.migrateWorkflowFiles();
    return this.listWorkflowsRaw();
  }

  /**
   * Delete a workflow by uid or name.
   */
  async deleteWorkflow(nameOrUid: string): Promise<boolean> {
    const state = await this.loadWorkflow(nameOrUid);
    if (!state) return false;
    const uid = ensureWorkflowUid(state.workflow);
    let removed = false;
    try {
      await unlink(this.workflowPathByUid(uid));
      removed = true;
    } catch {
      // fall through to legacy name file
    }
    try {
      await unlink(this.workflowPathByName(state.workflow.metadata.name));
      removed = true;
    } catch {
      // ignore
    }
    return removed;
  }

  // ==========================================================================
  // Run Operations
  // ==========================================================================

  /**
   * Save a run (atomic tmp + rename)
   */
  async saveRun(run: Run): Promise<void> {
    await this.withRunLock(run.id, async () => {
      const path = join(this.stateDir, 'runs', `${run.id}.json`);
      await writeTextAtomic(path, JSON.stringify(run, null, 2));
    });
  }

  /**
   * Load a run by ID
   */
  async loadRun(runId: string): Promise<Run | null> {
    const path = join(this.stateDir, 'runs', `${runId}.json`);
    try {
      const content = await readFile(path, 'utf-8');
      return normalizeRun(JSON.parse(content) as Run);
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
        if (!file.endsWith('.json') || file.endsWith('.transcript.jsonl')) continue;
        if (file.includes('.transcript.')) continue;
        const content = await readFile(join(dir, file), 'utf-8');
        const run = normalizeRun(JSON.parse(content) as Run);

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
   * Update a run under a per-run mutex
   */
  async updateRun(runId: string, updater: (run: Run) => Run): Promise<Run> {
    return this.withRunLock(runId, async () => {
      const path = join(this.stateDir, 'runs', `${runId}.json`);
      const content = await readFile(path, 'utf-8');
      const run = normalizeRun(JSON.parse(content) as Run);
      const updated = updater(run);
      await writeTextAtomic(path, JSON.stringify(updated, null, 2));
      return updated;
    });
  }

  /**
   * Delete a run
   */
  async deleteRun(runId: string): Promise<boolean> {
    const path = join(this.stateDir, 'runs', `${runId}.json`);
    const transcript = join(this.stateDir, 'runs', `${runId}.transcript.jsonl`);
    let deleted = false;
    try {
      await unlink(path);
      deleted = true;
    } catch {
      // ignore missing run
    }
    try {
      await unlink(transcript);
    } catch {
      // ignore missing transcript
    }
    return deleted;
  }

  async appendTranscript(
    runId: string,
    event: Omit<TranscriptEvent, 'ts'> & { ts?: string },
  ): Promise<TranscriptEvent> {
    return appendTranscriptEvent(this.stateDir, runId, event);
  }

  async loadTranscript(
    runId: string,
    options: { after?: string; limit?: number } = {},
  ): Promise<{ events: TranscriptEvent[]; nextAfter?: string }> {
    return loadTranscriptEvents(this.stateDir, runId, options)
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get workflow statistics
   */
  async getStats(workflowName: string): Promise<{
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
  }> {
    const runs = await this.listRuns(workflowName);
    return {
      totalRuns: runs.length,
      completedRuns: runs.filter((run) => run.status === WorkflowStatus.Completed).length,
      failedRuns: runs.filter((run) => run.status === WorkflowStatus.Failed).length,
    };
  }
}
