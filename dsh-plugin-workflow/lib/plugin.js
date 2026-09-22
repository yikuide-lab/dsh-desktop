/**
 * DSH Workflow Plugin
 * Integrates workflow engine as a Cordis plugin for DSH Desktop
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { WorkflowStore } from './engine/store.js';
import { Coordinator } from './engine/coordinator.js';
import { createDesktopExecutor } from './engine/executor.js';
import { TriggerManager } from './triggers/trigger.js';
import { MCPServer } from './mcp/server.js';
import { listBuiltinTemplates } from './templates.js';
import { allocateUserTemplateId, loadUserTemplates, removeUserTemplate, writeUserTemplate, } from './user-templates.js';
import { parseWorkflow, validateWorkflow, serializeWorkflow, WorkflowStatus, TaskStatus, StepType, DispatchStatus, RUN_SCHEMA_VERSION, } from './engine/models.js';
import { isGatePass, markAborted, isRunComplete, resolveGate } from './engine/engine.js';
import { truncateTranscriptText } from './engine/transcript.js';
import { buildWorkflowStatsDetail, buildWorkflowStatsSummaries, summarizeWorkflowRuns, } from './engine/workflow-stats.js';
/** Internal params key tracking workflow names already on the call stack. */
export const WORKFLOW_STACK_PARAM = '__workflowStack';
export function defaultWorkflowSettings() {
    return {
        providers: [],
        defaultBias: 'coding',
        defaultRetries: 2,
        defaultOnFailure: 'fail',
        maxRetainedRuns: 200,
        maxRunAgeDays: 30,
        scriptPolicy: 'allow',
    };
}
function normalizeOnFailure(value) {
    if (value === 'skip' || value === 'compensate' || value === 'fail')
        return value;
    return 'fail';
}
function normalizeRetries(value) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0)
        return value;
    return 2;
}
function normalizeNonNegInt(value, fallback) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0)
        return value;
    return fallback;
}
function normalizeScriptPolicy(value, fallback) {
    if (value === 'allow' || value === 'deny' || value === 'workspace-only')
        return value;
    return fallback;
}
function summarizeTranscriptOutput(output) {
    if (output == null)
        return output;
    if (typeof output === 'string')
        return truncateTranscriptText(output);
    if (typeof output !== 'object')
        return output;
    try {
        const raw = JSON.stringify(output);
        if (raw.length <= 16_000)
            return output;
        return { truncated: true, preview: truncateTranscriptText(raw) };
    }
    catch {
        return String(output);
    }
}
/** True when a running run only waits on unresolved gates (no in-flight work). */
export function isWaitingOnlyOnGates(run) {
    const unresolved = Object.values(run.gates).some((gate) => !gate.resolved);
    if (!unresolved)
        return false;
    for (const task of Object.values(run.tasks)) {
        for (const dispatch of task.dispatches) {
            if (dispatch.status === DispatchStatus.Queued
                || dispatch.status === DispatchStatus.Running) {
                return false;
            }
        }
    }
    return true;
}
export class WorkflowPlugin {
    store;
    coordinators = new Map();
    persistQueues = new Map();
    triggerManager;
    mcpServer = null;
    config;
    executor;
    hostHooks = {};
    bindingsPath;
    settingsPath;
    triggersPath;
    settings = defaultWorkflowSettings();
    userTemplates = [];
    constructor(config = {}) {
        this.config = {
            stateDir: config.stateDir ?? join(homedir(), '.dsh', 'workflow'),
            maxConcurrency: config.maxConcurrency ?? 4,
            maxActiveRuns: config.maxActiveRuns ?? 4,
            maxNestedDepth: config.maxNestedDepth ?? 3,
            tickInterval: config.tickInterval ?? 1000,
            heartbeatTimeout: config.heartbeatTimeout ?? 900_000,
            mcpEnabled: config.mcpEnabled ?? true,
            mcpDangerousToolsEnabled: config.mcpDangerousToolsEnabled ?? false,
            triggersEnabled: config.triggersEnabled ?? false,
            scriptPolicy: config.scriptPolicy ?? 'allow',
            maxRetainedRuns: config.maxRetainedRuns ?? 200,
            maxRunAgeDays: config.maxRunAgeDays ?? 30,
        };
        this.store = new WorkflowStore(this.config.stateDir);
        this.triggerManager = new TriggerManager((triggerConfig) => {
            void this.handleTrigger(triggerConfig);
        });
        this.bindingsPath = join(this.config.stateDir, 'bindings.json');
        this.settingsPath = join(this.config.stateDir, 'settings.json');
        this.triggersPath = join(this.config.stateDir, 'triggers.json');
        this.rebuildExecutor();
    }
    /** Replace Host LLM/task hooks while keeping nested sub_workflow wired. */
    setHostHooks(hooks = {}) {
        const { runSubWorkflow: _ignored, ...rest } = hooks;
        this.hostHooks = rest;
        this.rebuildExecutor();
    }
    /** Replace the step executor used by new runs (advanced; prefer setHostHooks). */
    setExecutor(executor) {
        this.executor = executor;
    }
    rebuildExecutor() {
        const hostHooks = this.hostHooks;
        this.executor = createDesktopExecutor({
            scriptPolicy: (this.settings.scriptPolicy ?? this.config.scriptPolicy),
            hooks: {
                runLlm: hostHooks.runLlm
                    ? async (step, context, cwd, signal) => {
                        await this.safeTranscript(context.runId, {
                            type: 'llm.request',
                            stepId: step.id,
                            data: {
                                role: step.role,
                                model: step.model,
                                prompt: truncateTranscriptText(step.prompt ?? ''),
                                cwd,
                            },
                        });
                        const outcome = await hostHooks.runLlm(step, context, cwd, signal);
                        await this.safeTranscript(context.runId, {
                            type: 'llm.response',
                            stepId: step.id,
                            data: {
                                ok: outcome.ok,
                                error: outcome.error,
                                output: summarizeTranscriptOutput(outcome.output),
                            },
                        });
                        return outcome;
                    }
                    : undefined,
                runTask: hostHooks.runTask
                    ? async (step, context, cwd, signal) => {
                        await this.safeTranscript(context.runId, {
                            type: 'task.request',
                            stepId: step.id,
                            data: {
                                role: step.role,
                                model: step.model,
                                inputs: step.inputs,
                                cwd,
                            },
                        });
                        const outcome = await hostHooks.runTask(step, context, cwd, signal);
                        await this.safeTranscript(context.runId, {
                            type: 'task.response',
                            stepId: step.id,
                            data: {
                                ok: outcome.ok,
                                error: outcome.error,
                                output: summarizeTranscriptOutput(outcome.output),
                            },
                        });
                        return outcome;
                    }
                    : undefined,
                runSubWorkflow: (step, context, signal) => this.executeSubWorkflow(step, context, signal),
            },
        });
    }
    async safeTranscript(runId, event) {
        try {
            await this.store.appendTranscript(runId, event);
        }
        catch (error) {
            console.error('[workflow] transcript append failed:', error);
        }
    }
    schedulePersist(runId) {
        const previous = this.persistQueues.get(runId) ?? Promise.resolve();
        const next = previous
            .catch(() => undefined)
            .then(async () => {
            const live = this.getLiveCoordinator(runId)?.getRun();
            if (live) {
                await this.store.saveRun(live);
                return;
            }
        });
        this.persistQueues.set(runId, next);
        void next.finally(() => {
            if (this.persistQueues.get(runId) === next)
                this.persistQueues.delete(runId);
        });
    }
    createCoordinator() {
        const coordinator = new Coordinator({
            maxConcurrency: this.config.maxConcurrency,
            tickInterval: this.config.tickInterval,
            heartbeatTimeout: this.config.heartbeatTimeout,
            failurePolicy: {
                defaultRetries: this.settings.defaultRetries,
                defaultOnFailure: this.settings.defaultOnFailure,
            },
        });
        coordinator.on('task:dispatch', (stepId, dispatchId) => {
            const run = coordinator.getRun();
            if (!run)
                return;
            void this.safeTranscript(run.id, {
                type: 'dispatch.submit',
                stepId,
                dispatchId,
            });
            this.schedulePersist(run.id);
        });
        coordinator.on('task:settle', (stepId, dispatchId, result) => {
            const run = coordinator.getRun();
            if (!run)
                return;
            void this.safeTranscript(run.id, {
                type: 'dispatch.settle',
                stepId,
                dispatchId,
                data: {
                    success: result.success,
                    error: result.error,
                    output: summarizeTranscriptOutput(result.output),
                },
            });
            this.schedulePersist(run.id);
        });
        coordinator.on('run:complete', (run) => {
            void this.safeTranscript(run.id, { type: 'run.complete' });
            const persist = (this.persistQueues.get(run.id) ?? Promise.resolve())
                .catch(() => undefined)
                .then(() => this.store.saveRun(run));
            this.persistQueues.set(run.id, persist);
            void persist.finally(() => {
                this.detachCoordinator(run.id);
                if (this.persistQueues.get(run.id) === persist)
                    this.persistQueues.delete(run.id);
            });
        });
        coordinator.on('run:fail', (run) => {
            void this.safeTranscript(run.id, {
                type: 'run.fail',
                data: { error: run.error },
            });
            const persist = (this.persistQueues.get(run.id) ?? Promise.resolve())
                .catch(() => undefined)
                .then(() => this.store.saveRun(run));
            this.persistQueues.set(run.id, persist);
            void persist.finally(() => {
                this.detachCoordinator(run.id);
                if (this.persistQueues.get(run.id) === persist)
                    this.persistQueues.delete(run.id);
            });
        });
        return coordinator;
    }
    detachCoordinator(runId) {
        const coordinator = this.coordinators.get(runId);
        if (!coordinator)
            return;
        coordinator.stop();
        this.coordinators.delete(runId);
    }
    countActiveRuns() {
        let count = 0;
        for (const coordinator of this.coordinators.values()) {
            if (coordinator.getRun()?.status === WorkflowStatus.Running)
                count += 1;
        }
        return count;
    }
    listLiveRuns() {
        const runs = [];
        for (const coordinator of this.coordinators.values()) {
            const run = coordinator.getRun();
            if (run)
                runs.push(run);
        }
        return runs;
    }
    getLiveCoordinator(runId) {
        return this.coordinators.get(runId);
    }
    async init() {
        await this.store.init();
        await mkdir(this.config.stateDir, { recursive: true });
        this.settings = await this.readSettings();
        this.userTemplates = await loadUserTemplates(this.config.stateDir);
        await this.recoverOrphanRuns();
        if (this.config.triggersEnabled) {
            await this.loadPersistedTriggers();
        }
        await this.purgeRuns({ quiet: true }).catch((error) => {
            console.error('[workflow] retention purge on init failed:', error);
        });
        if (this.config.mcpEnabled) {
            this.mcpServer = new MCPServer(this);
            console.log('[workflow] MCP server ready (stdio mode)');
        }
        console.log(`[workflow] Initialized with state dir: ${this.config.stateDir}`);
    }
    /** Fail-closed: mark disk runs still "running" as aborted after process restart,
     * unless they are only waiting on unresolved gates with no in-flight dispatches. */
    async recoverOrphanRuns() {
        const runs = await this.store.listRuns();
        for (const run of runs) {
            if (run.status !== WorkflowStatus.Running)
                continue;
            if (isWaitingOnlyOnGates(run)) {
                await this.safeTranscript(run.id, {
                    type: 'run.orphan',
                    data: { preserved: true, reason: 'waiting on unresolved gate' },
                });
                continue;
            }
            const updated = markAborted(run, 'orphan after process restart');
            await this.store.saveRun(updated);
            await this.safeTranscript(run.id, {
                type: 'run.orphan',
                data: { reason: 'orphan after process restart' },
            });
        }
    }
    async startMCP() {
        if (this.mcpServer) {
            await this.mcpServer.startStdio();
        }
    }
    async createWorkflow(yaml) {
        const workflow = await parseWorkflow(yaml);
        const validation = validateWorkflow(workflow);
        if (validation.ok) {
            const state = await this.store.saveWorkflow(workflow);
            return { workflow: state.workflow, validation };
        }
        return { workflow, validation };
    }
    async validateYaml(yaml) {
        const workflow = await parseWorkflow(yaml);
        return validateWorkflow(workflow);
    }
    async getWorkflow(name) {
        const state = await this.store.loadWorkflow(name);
        return state?.workflow ?? null;
    }
    async listWorkflows() {
        const states = await this.store.listWorkflows();
        return states.map(s => s.workflow);
    }
    async deleteWorkflow(name) {
        return this.store.deleteWorkflow(name);
    }
    async exportWorkflowYaml(name) {
        const workflow = await this.getWorkflow(name);
        if (!workflow)
            return null;
        return serializeWorkflow(workflow);
    }
    /** Parse YAML then dump with Host js-yaml (canonical round-trip). */
    async canonicalizeYaml(yaml) {
        const workflow = await parseWorkflow(yaml);
        return serializeWorkflow(workflow);
    }
    listTemplates() {
        return [
            ...listBuiltinTemplates().map((template) => ({ ...template, builtin: true })),
            ...this.userTemplates,
        ];
    }
    /**
     * Persist a user template (import or promote-from-workflow).
     * Built-in ids cannot be overwritten.
     */
    async saveUserTemplate(input) {
        const workflow = await parseWorkflow(input.yaml);
        const validation = validateWorkflow(workflow);
        if (!validation.ok) {
            throw new Error(`Template validation failed: ${validation.errors.map((e) => e.message).join(', ')}`);
        }
        const yaml = await serializeWorkflow(workflow);
        const preferredId = input.id?.trim()
            || workflow.metadata.name
            || input.name?.trim()
            || 'user-template';
        const builtinIds = new Set(listBuiltinTemplates().map((entry) => entry.id));
        if (input.id && builtinIds.has(input.id)) {
            throw new Error(`Cannot overwrite built-in template: ${input.id}`);
        }
        const updating = input.id
            ? this.userTemplates.find((entry) => entry.id === input.id)
            : undefined;
        const finalId = updating
            ? updating.id
            : allocateUserTemplateId(preferredId, [
                ...builtinIds,
                ...this.userTemplates.map((entry) => entry.id),
            ]);
        const record = {
            id: finalId,
            name: (input.name?.trim() || workflow.metadata.title || workflow.metadata.name || finalId).trim(),
            description: input.description?.trim()
                || workflow.metadata.description
                || '',
            category: input.category ?? 'custom',
            yaml,
            builtin: false,
            updatedAt: new Date().toISOString(),
            ...(input.sourceWorkflowName?.trim()
                ? { sourceWorkflowName: input.sourceWorkflowName.trim() }
                : {}),
        };
        await writeUserTemplate(this.config.stateDir, record);
        this.userTemplates = [
            ...this.userTemplates.filter((entry) => entry.id !== record.id),
            record,
        ].sort((a, b) => a.name.localeCompare(b.name));
        return record;
    }
    /** Delete a user-saved template. Built-ins cannot be removed. */
    async deleteUserTemplate(id) {
        if (listBuiltinTemplates().some((entry) => entry.id === id)) {
            throw new Error(`Cannot delete built-in template: ${id}`);
        }
        const removed = await removeUserTemplate(this.config.stateDir, id);
        if (removed) {
            this.userTemplates = this.userTemplates.filter((entry) => entry.id !== id);
        }
        return removed;
    }
    /**
     * Promote a saved workflow into the user template catalog.
     * Does not delete or alter the original workflow.
     */
    async promoteWorkflowToTemplate(workflowName, options) {
        const yaml = await this.exportWorkflowYaml(workflowName);
        if (!yaml)
            throw new Error(`Workflow not found: ${workflowName}`);
        const workflow = await this.getWorkflow(workflowName);
        return this.saveUserTemplate({
            yaml,
            name: options?.name ?? workflow?.metadata.title ?? workflowName,
            description: options?.description ?? workflow?.metadata.description ?? '',
            category: options?.category ?? 'custom',
            ...(options?.id ? { id: options.id } : {}),
            sourceWorkflowName: workflowName,
        });
    }
    /** Synchronous cached settings for Host executor routing. */
    getSettingsSync() {
        return this.settings;
    }
    async getSettings() {
        this.settings = await this.readSettings();
        return this.settings;
    }
    async setSettings(settings) {
        const normalized = {
            defaultBias: typeof settings.defaultBias === 'string' && settings.defaultBias.trim()
                ? settings.defaultBias.trim()
                : 'coding',
            defaultRetries: normalizeRetries(settings.defaultRetries),
            defaultOnFailure: normalizeOnFailure(settings.defaultOnFailure),
            maxRetainedRuns: normalizeNonNegInt(settings.maxRetainedRuns, this.config.maxRetainedRuns),
            maxRunAgeDays: normalizeNonNegInt(settings.maxRunAgeDays, this.config.maxRunAgeDays),
            scriptPolicy: normalizeScriptPolicy(settings.scriptPolicy, this.config.scriptPolicy),
            providers: Array.isArray(settings.providers)
                ? settings.providers
                    .filter((entry) => (!!entry
                    && typeof entry.id === 'string'
                    && typeof entry.model === 'string'
                    && entry.model.includes('/')
                    && Array.isArray(entry.bias)))
                    .map((entry) => ({
                    id: entry.id.trim(),
                    model: entry.model.trim(),
                    bias: entry.bias.map((item) => String(item).trim()).filter(Boolean),
                }))
                : [],
        };
        await mkdir(this.config.stateDir, { recursive: true });
        await writeFile(this.settingsPath, JSON.stringify(normalized, null, 2), 'utf8');
        this.settings = normalized;
        this.rebuildExecutor();
        for (const coordinator of this.coordinators.values()) {
            coordinator.setFailurePolicy({
                defaultRetries: normalized.defaultRetries,
                defaultOnFailure: normalized.defaultOnFailure,
            });
        }
        await this.purgeRuns({ quiet: true }).catch(() => undefined);
        return normalized;
    }
    async startRun(workflowName, params, options = {}) {
        const workflow = await this.getWorkflow(workflowName);
        if (!workflow) {
            throw new Error(`Workflow not found: ${workflowName}`);
        }
        const validation = validateWorkflow(workflow);
        if (!validation.ok) {
            throw new Error(`Workflow validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
        }
        if (this.countActiveRuns() >= this.config.maxActiveRuns) {
            throw new Error(`Maximum active runs (${this.config.maxActiveRuns}) reached. Stop a running workflow before starting another.`);
        }
        const coordinator = this.createCoordinator();
        const run = await coordinator.init(workflow, this.executor, params, {
            parentRunId: options.parentRunId,
            rootRunId: options.rootRunId ?? options.parentRunId,
            coordinatorId: `coord-${workflowName}`,
        });
        this.coordinators.set(run.id, coordinator);
        await this.store.saveRun(run);
        await this.safeTranscript(run.id, {
            type: 'run.start',
            data: {
                workflowName,
                parentRunId: options.parentRunId,
                rootRunId: options.rootRunId ?? options.parentRunId,
                params: run.params,
            },
        });
        coordinator.start();
        return run;
    }
    async getRun(runId) {
        const live = this.getLiveCoordinator(runId)?.getRun();
        if (live)
            return live;
        return this.store.loadRun(runId);
    }
    async listRuns(workflowName) {
        const stored = await this.store.listRuns(workflowName);
        const live = this.listLiveRuns().filter((run) => (!workflowName || run.workflowName === workflowName));
        const byId = new Map();
        for (const run of stored)
            byId.set(run.id, run);
        for (const run of live)
            byId.set(run.id, run);
        return [...byId.values()].sort((a, b) => (String(b.startedAt).localeCompare(String(a.startedAt))));
    }
    async stopRun(runId) {
        // Cascade abort to nested children first.
        const children = this.listLiveRuns().filter((run) => run.parentRunId === runId);
        for (const child of children) {
            await this.stopRun(child.id);
        }
        const coordinator = this.getLiveCoordinator(runId);
        if (coordinator) {
            const updated = await coordinator.abortRun('stopped by user');
            if (updated) {
                await this.store.saveRun(updated);
                await this.safeTranscript(runId, {
                    type: 'run.abort',
                    data: { reason: 'stopped by user' },
                });
                this.detachCoordinator(runId);
                return updated;
            }
        }
        return this.store.updateRun(runId, (r) => markAborted(r, 'stopped by user')).then(async (updated) => {
            await this.safeTranscript(runId, {
                type: 'run.abort',
                data: { reason: 'stopped by user', offline: true },
            });
            return updated;
        });
    }
    /**
     * Synchronously nest a child workflow run for a sub_workflow step.
     * Honors AbortSignal (parent step abort) and circular-ref / depth guards.
     */
    async executeSubWorkflow(step, context, signal) {
        if (step.type !== StepType.SubWorkflow) {
            return { ok: false, error: `Expected sub_workflow step, got ${step.type}` };
        }
        const ref = typeof step.ref === 'string' ? step.ref.trim() : '';
        if (!ref)
            return { ok: false, error: 'Sub-workflow step missing ref' };
        const parentName = context.workflow.metadata.name;
        const rawStack = context.params?.[WORKFLOW_STACK_PARAM];
        const stack = Array.isArray(rawStack)
            ? rawStack.map(String)
            : [parentName];
        if (stack.includes(ref)) {
            return {
                ok: false,
                error: `Circular sub_workflow: ${[...stack, ref].join(' -> ')}`,
            };
        }
        if (stack.length >= this.config.maxNestedDepth) {
            return {
                ok: false,
                error: `sub_workflow nesting exceeds maxNestedDepth (${this.config.maxNestedDepth})`,
            };
        }
        const childParams = {
            ...(context.params ?? {}),
            [WORKFLOW_STACK_PARAM]: [...stack, ref],
            __parentRunId: context.runId,
        };
        if (step.inputs && typeof step.inputs === 'object' && !Array.isArray(step.inputs)) {
            for (const [key, value] of Object.entries(step.inputs)) {
                if (typeof value === 'string'
                    || typeof value === 'number'
                    || typeof value === 'boolean') {
                    childParams[key] = value;
                }
            }
        }
        let child;
        try {
            const parentRun = await this.getRun(context.runId);
            child = await this.startRun(ref, childParams, {
                parentRunId: context.runId,
                rootRunId: parentRun?.rootRunId ?? context.runId,
            });
        }
        catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
        const pollMs = Math.max(50, Math.min(this.config.tickInterval, 250));
        while (true) {
            if (signal.aborted) {
                await this.stopRun(child.id).catch(() => undefined);
                return { ok: false, error: 'aborted', output: { childRunId: child.id } };
            }
            const latest = await this.getRun(child.id);
            if (!latest) {
                return { ok: false, error: `Child run disappeared: ${child.id}` };
            }
            if (latest.status === WorkflowStatus.Completed) {
                return {
                    ok: true,
                    output: {
                        childRunId: latest.id,
                        workflowName: latest.workflowName,
                        status: latest.status,
                        tasks: Object.fromEntries(Object.entries(latest.tasks).map(([id, task]) => [id, task.status])),
                    },
                };
            }
            if (latest.status === WorkflowStatus.Failed
                || latest.status === WorkflowStatus.Aborted) {
                const failedTask = Object.values(latest.tasks).find((task) => (task.status === TaskStatus.Failed && typeof task.error === 'string' && task.error));
                return {
                    ok: false,
                    error: latest.error
                        ?? failedTask?.error
                        ?? `Child workflow "${latest.workflowName}" ${latest.status}`,
                    output: {
                        childRunId: latest.id,
                        workflowName: latest.workflowName,
                        status: latest.status,
                    },
                };
            }
            await new Promise((resolve) => setTimeout(resolve, pollMs));
        }
    }
    async listPendingGates(runId) {
        const runs = runId
            ? [await this.getRun(runId)].filter((r) => r !== null)
            : await this.listRuns();
        const pending = [];
        for (const run of runs) {
            for (const gate of Object.values(run.gates)) {
                if (gate.resolved || !gate.token)
                    continue;
                pending.push({
                    runId: run.id,
                    stepId: gate.stepId,
                    question: gate.question,
                    options: gate.options,
                    ...(gate.pass ? { pass: gate.pass } : {}),
                    token: gate.token,
                });
            }
        }
        return pending;
    }
    async resolveGate(runId, stepId, decision, resolvedBy, token) {
        const coordinator = this.getLiveCoordinator(runId);
        if (coordinator) {
            coordinator.resolveGate(stepId, decision, resolvedBy, token);
            const updated = coordinator.getRun();
            if (!updated)
                throw new Error(`Run not found after resolve: ${runId}`);
            await this.store.saveRun(updated);
            await this.safeTranscript(runId, {
                type: 'gate.resolve',
                stepId,
                data: { decision, resolvedBy, live: true },
            });
            coordinator.start();
            return updated;
        }
        // Offline resolve for persisted runs (no live coordinator).
        const run = await this.store.loadRun(runId);
        if (!run)
            throw new Error(`Run not found: ${runId}`);
        const workflow = await this.getWorkflow(run.workflowName);
        const updated = resolveGate(run, stepId, decision, resolvedBy, token, {
            ...(workflow ? { workflow } : {}),
        });
        const approved = isGatePass(updated.gates[stepId], decision);
        await this.store.saveRun(updated);
        await this.safeTranscript(runId, {
            type: 'gate.resolve',
            stepId,
            data: { decision, resolvedBy, live: false, approved },
        });
        // Reattach so the DAG can continue after process restart / detach.
        if (!isRunComplete(updated)) {
            const resumeTarget = updated.status === WorkflowStatus.Running
                ? updated
                : { ...updated, status: WorkflowStatus.Running };
            if (resumeTarget !== updated)
                await this.store.saveRun(resumeTarget);
            await this.reattachRun(resumeTarget);
        }
        return this.getLiveCoordinator(runId)?.getRun() ?? updated;
    }
    /** Resume a persisted running run with a live coordinator + tick loop. */
    async reattachRun(run) {
        if (this.coordinators.has(run.id))
            return;
        if (this.countActiveRuns() >= this.config.maxActiveRuns) {
            throw new Error(`Cannot resume run ${run.id}: maximum active runs (${this.config.maxActiveRuns}) reached.`);
        }
        const workflow = await this.getWorkflow(run.workflowName);
        if (!workflow) {
            throw new Error(`Cannot resume run ${run.id}: workflow not found: ${run.workflowName}`);
        }
        const coordinator = this.createCoordinator();
        await coordinator.resume(workflow, run, this.executor);
        this.coordinators.set(run.id, coordinator);
        coordinator.start();
    }
    async getTranscript(runId, options = {}) {
        return this.store.loadTranscript(runId, options);
    }
    async listBindings() {
        return this.readBindings();
    }
    async getBinding(workspaceId) {
        const bindings = await this.readBindings();
        return bindings.find(b => b.workspaceId === workspaceId) ?? null;
    }
    async setBinding(workspaceId, workflowName) {
        const workflow = await this.getWorkflow(workflowName);
        if (!workflow)
            throw new Error(`Workflow not found: ${workflowName}`);
        const bindings = await this.readBindings();
        const next = {
            workspaceId,
            workflowName,
            updatedAt: new Date().toISOString(),
        };
        const without = bindings.filter(b => b.workspaceId !== workspaceId);
        await this.writeBindings([...without, next]);
        return next;
    }
    async clearBinding(workspaceId) {
        const bindings = await this.readBindings();
        const next = bindings.filter(b => b.workspaceId !== workspaceId);
        if (next.length === bindings.length)
            return false;
        await this.writeBindings(next);
        return true;
    }
    /** Start the workflow bound to a workspace, injecting workspace context. */
    async startBoundRun(workspaceId, params) {
        const binding = await this.getBinding(workspaceId);
        if (!binding)
            throw new Error(`No workflow bound for workspace: ${workspaceId}`);
        return this.startRun(binding.workflowName, {
            ...params,
            workspaceId,
            ...(typeof params?.workspaceRoot === 'string'
                && (params.workspaceRoot.startsWith('/')
                    || /^[A-Za-z]:[\\/]/.test(params.workspaceRoot))
                ? { workspaceRoot: params.workspaceRoot }
                : {}),
        });
    }
    /** Whether MCP may invoke destructive tools (delete/stop/resolve). */
    areDangerousMcpToolsEnabled() {
        return this.config.mcpDangerousToolsEnabled;
    }
    addTrigger(config) {
        this.assertTriggersEnabled();
        const { timezone: _ignored, ...rest } = config;
        const record = this.triggerManager.add(rest);
        void this.persistTriggers();
        return { id: record.id, config: record.config };
    }
    removeTrigger(id) {
        this.assertTriggersEnabled();
        const removed = this.triggerManager.remove(id);
        if (removed)
            void this.persistTriggers();
        return removed;
    }
    enableTrigger(id) {
        this.assertTriggersEnabled();
        this.triggerManager.enable(id);
        void this.persistTriggers();
    }
    disableTrigger(id) {
        this.assertTriggersEnabled();
        this.triggerManager.disable(id);
        void this.persistTriggers();
    }
    fireManualTrigger(triggerId, params) {
        this.assertTriggersEnabled();
        this.triggerManager.manual(triggerId, params);
    }
    listTriggers() {
        if (!this.config.triggersEnabled)
            return [];
        return this.triggerManager.list().map(r => ({
            id: r.id,
            config: r.config,
            enabled: r.enabled,
            nextTrigger: r.nextTrigger,
        }));
    }
    async deleteRun(runId) {
        if (this.coordinators.has(runId)) {
            await this.stopRun(runId).catch(() => undefined);
        }
        return this.store.deleteRun(runId);
    }
    async exportRun(runId) {
        const run = await this.getRun(runId);
        if (!run)
            return null;
        const transcript = await this.getTranscript(runId);
        return {
            schemaVersion: RUN_SCHEMA_VERSION,
            run,
            transcript: transcript.events,
        };
    }
    async purgeRuns(options = {}) {
        const maxRetained = this.settings.maxRetainedRuns
            ?? this.config.maxRetainedRuns;
        const maxAgeDays = this.settings.maxRunAgeDays
            ?? this.config.maxRunAgeDays;
        const runs = await this.store.listRuns();
        const liveIds = new Set(this.coordinators.keys());
        const finished = runs.filter((run) => (!liveIds.has(run.id)
            && run.status !== WorkflowStatus.Running));
        const cutoff = maxAgeDays > 0
            ? Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
            : null;
        const toDelete = new Set();
        for (const run of finished) {
            const completedMs = Date.parse(run.completedAt ?? run.startedAt);
            if (cutoff !== null && Number.isFinite(completedMs) && completedMs < cutoff) {
                toDelete.add(run.id);
            }
        }
        if (maxRetained > 0) {
            const keep = finished
                .filter((run) => !toDelete.has(run.id))
                .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
            for (const run of keep.slice(maxRetained)) {
                toDelete.add(run.id);
            }
        }
        let deleted = 0;
        for (const runId of toDelete) {
            if (await this.store.deleteRun(runId))
                deleted += 1;
        }
        if (!options.quiet && deleted > 0) {
            console.log(`[workflow] purged ${deleted} retained run(s)`);
        }
        return { deleted };
    }
    fireEvent(source, name, data) {
        this.assertTriggersEnabled();
        this.triggerManager.fireEvent({
            source,
            name,
            data,
            timestamp: new Date().toISOString(),
        });
    }
    assertTriggersEnabled() {
        if (!this.config.triggersEnabled) {
            throw new Error('Workflow triggers are disabled. Set triggersEnabled: true when constructing WorkflowPlugin to use cron/event/manual triggers.');
        }
    }
    async handleTrigger(config) {
        if (!this.config.triggersEnabled)
            return;
        try {
            await this.startRun(config.workflowName, config.params);
            console.log(`[workflow] Triggered workflow: ${config.workflowName}`);
        }
        catch (error) {
            console.error('[workflow] Trigger failed:', error);
        }
    }
    async getStats() {
        const workflows = await this.store.listWorkflows();
        const allRuns = await this.listRuns();
        const coordinators = [...this.coordinators.entries()].map(([runId, coordinator]) => ({
            runId,
            stats: coordinator.getStats(),
        }));
        return {
            workflows: workflows.length,
            runs: {
                total: allRuns.length,
                running: allRuns.filter(r => r.status === 'running').length,
                completed: allRuns.filter(r => r.status === 'completed').length,
                failed: allRuns.filter(r => r.status === 'failed').length,
            },
            triggers: this.triggerManager.list().length,
            activeRuns: this.countActiveRuns(),
            maxActiveRuns: this.config.maxActiveRuns,
            apiVersion: 1,
            runSchemaVersion: RUN_SCHEMA_VERSION,
            coordinators,
        };
    }
    /**
     * Per-workflow usage summaries from retained top-level runs.
     * When `workflowName` is set, returns a single-element array (zeros if unknown / no runs).
     */
    async getWorkflowStats(workflowName) {
        const workflows = await this.listWorkflows();
        const allRuns = await this.listRuns();
        if (workflowName) {
            const workflow = workflows.find((entry) => entry.metadata.name === workflowName);
            return [summarizeWorkflowRuns(workflowName, allRuns.filter((run) => run.workflowName === workflowName), workflow?.metadata.title)];
        }
        return buildWorkflowStatsSummaries(workflows, allRuns);
    }
    async getWorkflowStatsDetail(workflowName, options) {
        const workflows = await this.listWorkflows();
        const allRuns = await this.listRuns(workflowName);
        return buildWorkflowStatsDetail(workflowName, workflows, allRuns, options);
    }
    shutdown = Promise.resolve();
    stop() {
        const runIds = [...this.coordinators.keys()];
        this.shutdown = Promise.all(runIds.map(async (runId) => {
            try {
                await this.stopRun(runId);
            }
            catch (error) {
                console.error(`[workflow] stopRun(${runId}) during plugin.stop failed:`, error);
                this.detachCoordinator(runId);
            }
        })).then(() => undefined);
        this.triggerManager.stop();
    }
    /** Await in-flight shutdown from {@link stop} (tests / Host teardown). */
    async whenStopped() {
        await this.shutdown;
    }
    async readBindings() {
        try {
            const raw = await readFile(this.bindingsPath, 'utf8');
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed))
                return [];
            return parsed.filter((item) => (typeof item === 'object'
                && item !== null
                && typeof item.workspaceId === 'string'
                && typeof item.workflowName === 'string'
                && typeof item.updatedAt === 'string'));
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return [];
            throw error;
        }
    }
    async writeBindings(bindings) {
        await mkdir(this.config.stateDir, { recursive: true });
        await writeFile(this.bindingsPath, JSON.stringify(bindings, null, 2), 'utf8');
    }
    async readSettings() {
        try {
            const raw = await readFile(this.settingsPath, 'utf8');
            const parsed = JSON.parse(raw);
            return {
                defaultBias: typeof parsed.defaultBias === 'string' ? parsed.defaultBias : 'coding',
                defaultRetries: normalizeRetries(parsed.defaultRetries),
                defaultOnFailure: normalizeOnFailure(parsed.defaultOnFailure),
                maxRetainedRuns: normalizeNonNegInt(parsed.maxRetainedRuns, this.config.maxRetainedRuns),
                maxRunAgeDays: normalizeNonNegInt(parsed.maxRunAgeDays, this.config.maxRunAgeDays),
                scriptPolicy: normalizeScriptPolicy(parsed.scriptPolicy, this.config.scriptPolicy),
                providers: Array.isArray(parsed.providers) ? parsed.providers : [],
            };
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                return {
                    ...defaultWorkflowSettings(),
                    scriptPolicy: this.config.scriptPolicy,
                    maxRetainedRuns: this.config.maxRetainedRuns,
                    maxRunAgeDays: this.config.maxRunAgeDays,
                };
            }
            throw error;
        }
    }
    async persistTriggers() {
        if (!this.config.triggersEnabled)
            return;
        await mkdir(this.config.stateDir, { recursive: true });
        const records = this.triggerManager.list();
        await writeFile(this.triggersPath, JSON.stringify(records, null, 2), 'utf8');
    }
    async loadPersistedTriggers() {
        try {
            const raw = await readFile(this.triggersPath, 'utf8');
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed))
                return;
            for (const item of parsed) {
                if (!item || typeof item !== 'object')
                    continue;
                const record = item;
                if (typeof record.id !== 'string' || !record.config?.workflowName)
                    continue;
                this.triggerManager.restore({
                    id: record.id,
                    config: record.config,
                    enabled: record.enabled !== false,
                    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
                    ...(record.lastTriggered ? { lastTriggered: record.lastTriggered } : {}),
                    ...(record.nextTrigger ? { nextTrigger: record.nextTrigger } : {}),
                });
            }
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return;
            throw error;
        }
    }
}
export function createWorkflowPlugin(config) {
    return new WorkflowPlugin(config);
}
export default WorkflowPlugin;
//# sourceMappingURL=plugin.js.map