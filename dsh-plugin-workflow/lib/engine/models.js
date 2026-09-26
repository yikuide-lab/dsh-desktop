/**
 * Workflow Engine Models
 * TypeScript rewrite of workflow-wise engine/models.py
 */
// ============================================================================
// Enums
// ============================================================================
export var WorkflowStatus;
(function (WorkflowStatus) {
    WorkflowStatus["Draft"] = "draft";
    WorkflowStatus["Proposed"] = "proposed";
    WorkflowStatus["Reviewing"] = "reviewing";
    WorkflowStatus["Approved"] = "approved";
    WorkflowStatus["Running"] = "running";
    WorkflowStatus["Completed"] = "completed";
    WorkflowStatus["Failed"] = "failed";
    WorkflowStatus["Aborted"] = "aborted";
    WorkflowStatus["Rejected"] = "rejected";
})(WorkflowStatus || (WorkflowStatus = {}));
export var TaskStatus;
(function (TaskStatus) {
    TaskStatus["Pending"] = "pending";
    TaskStatus["InProgress"] = "in_progress";
    TaskStatus["Completed"] = "completed";
    TaskStatus["Failed"] = "failed";
    TaskStatus["Skipped"] = "skipped";
})(TaskStatus || (TaskStatus = {}));
export var DispatchStatus;
(function (DispatchStatus) {
    DispatchStatus["Queued"] = "queued";
    DispatchStatus["Running"] = "running";
    DispatchStatus["Succeeded"] = "succeeded";
    DispatchStatus["Failed"] = "failed";
})(DispatchStatus || (DispatchStatus = {}));
export var StepType;
(function (StepType) {
    StepType["Script"] = "script";
    StepType["Task"] = "task";
    StepType["LLM"] = "llm";
    StepType["Approval"] = "approval";
    StepType["SubWorkflow"] = "sub_workflow";
    StepType["CollabPeer"] = "collab_peer";
})(StepType || (StepType = {}));
export var TriggerType;
(function (TriggerType) {
    TriggerType["Manual"] = "manual";
    TriggerType["Cron"] = "cron";
    TriggerType["Event"] = "event";
})(TriggerType || (TriggerType = {}));
/** Current on-disk Run JSON schema version written by this package. */
export const RUN_SCHEMA_VERSION = 1;
/** Canonical workflow document version accepted by the parser. */
export const WORKFLOW_API_VERSION = 'workflow-wise/v1';
/** Legacy aliases normalized to {@link WORKFLOW_API_VERSION}. */
export const WORKFLOW_API_VERSION_ALIASES = ['wfwise.io/v1'];
// ============================================================================
// DSL Parser
// ============================================================================
function stepFieldError(id, field, expected) {
    return new Error(`Step "${id}" field "${field}" must be ${expected}`);
}
function optionalString(raw, id, field) {
    const value = raw[field];
    if (value === undefined)
        return undefined;
    if (typeof value !== 'string')
        throw stepFieldError(id, field, 'a string');
    return value;
}
function optionalNonNegNumber(raw, id, field) {
    const value = raw[field];
    if (value === undefined)
        return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw stepFieldError(id, field, 'a non-negative number');
    }
    return value;
}
function optionalStringArray(raw, id, field) {
    const value = raw[field];
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        throw stepFieldError(id, field, 'an array of strings');
    }
    return value;
}
function optionalStringRecord(raw, id, field) {
    const value = raw[field];
    if (value === undefined)
        return undefined;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw stepFieldError(id, field, 'a string mapping');
    }
    for (const [key, item] of Object.entries(value)) {
        if (typeof item !== 'string') {
            throw stepFieldError(id, `${field}.${key}`, 'a string');
        }
    }
    return value;
}
/** Narrow a raw YAML step object to a typed {@link Step}, failing loudly on wrong field types. */
function normalizeStep(raw) {
    const id = raw.id;
    const step = {
        id,
        type: raw.type,
    };
    const deps = optionalStringArray(raw, id, 'deps');
    if (deps)
        step.deps = deps;
    const retries = optionalNonNegNumber(raw, id, 'retries');
    if (retries !== undefined)
        step.retries = retries;
    const onFailure = raw.on_failure;
    if (onFailure !== undefined) {
        if (onFailure !== 'fail' && onFailure !== 'skip' && onFailure !== 'compensate') {
            throw stepFieldError(id, 'on_failure', 'fail, skip, or compensate');
        }
        step.on_failure = onFailure;
    }
    const compensation = raw.compensation;
    if (compensation !== undefined) {
        if (compensation === null || typeof compensation !== 'object' || Array.isArray(compensation)) {
            throw stepFieldError(id, 'compensation', 'an object with "run"');
        }
        const comp = compensation;
        const compRun = comp.run;
        if (typeof compRun !== 'string') {
            throw stepFieldError(id, 'compensation.run', 'a string');
        }
        const compEnv = comp.env === undefined
            ? undefined
            : (() => {
                if (comp.env === null || typeof comp.env !== 'object' || Array.isArray(comp.env)) {
                    throw stepFieldError(id, 'compensation.env', 'a string mapping');
                }
                for (const [key, item] of Object.entries(comp.env)) {
                    if (typeof item !== 'string') {
                        throw stepFieldError(id, `compensation.env.${key}`, 'a string');
                    }
                }
                return comp.env;
            })();
        step.compensation = { run: compRun, ...(compEnv ? { env: compEnv } : {}) };
    }
    const run = optionalString(raw, id, 'run');
    if (run !== undefined)
        step.run = run;
    const env = optionalStringRecord(raw, id, 'env');
    if (env)
        step.env = env;
    const timeout = optionalNonNegNumber(raw, id, 'timeout');
    if (timeout !== undefined)
        step.timeout = timeout;
    const inputs = raw.inputs;
    if (inputs !== undefined) {
        if (inputs === null || typeof inputs !== 'object' || Array.isArray(inputs)) {
            throw stepFieldError(id, 'inputs', 'an object');
        }
        step.inputs = inputs;
    }
    const outputs = optionalStringArray(raw, id, 'outputs');
    if (outputs)
        step.outputs = outputs;
    const acceptance = optionalStringArray(raw, id, 'acceptance');
    if (acceptance)
        step.acceptance = acceptance;
    const harness = optionalString(raw, id, 'harness');
    if (harness !== undefined)
        step.harness = harness;
    const role = optionalString(raw, id, 'role');
    if (role !== undefined)
        step.role = role;
    const prompt = optionalString(raw, id, 'prompt');
    if (prompt !== undefined)
        step.prompt = prompt;
    const model = optionalString(raw, id, 'model');
    if (model !== undefined)
        step.model = model;
    const maxTokens = optionalNonNegNumber(raw, id, 'maxTokens');
    if (maxTokens !== undefined)
        step.maxTokens = maxTokens;
    const question = optionalString(raw, id, 'question');
    if (question !== undefined)
        step.question = question;
    const options = optionalStringArray(raw, id, 'options');
    if (options)
        step.options = options;
    const pass = optionalStringArray(raw, id, 'pass');
    if (pass)
        step.pass = pass;
    const ref = optionalString(raw, id, 'ref');
    if (ref !== undefined)
        step.ref = ref;
    const peer = raw.peer;
    if (peer !== undefined) {
        if (peer === null || typeof peer !== 'object' || Array.isArray(peer)) {
            throw stepFieldError(id, 'peer', 'an object');
        }
        const peerRaw = peer;
        const kind = peerRaw.kind;
        if (kind !== undefined) {
            if (typeof kind !== 'string') {
                throw stepFieldError(id, 'peer.kind', 'a string');
            }
            if (kind !== 'session' && kind !== 'agent' && kind !== 'workflow') {
                throw stepFieldError(id, 'peer.kind', 'session, agent, or workflow');
            }
        }
        const jid = typeof peerRaw.jid === 'string' ? peerRaw.jid : undefined;
        if (peerRaw.jid !== undefined && jid === undefined) {
            throw stepFieldError(id, 'peer.jid', 'a string');
        }
        const role = typeof peerRaw.role === 'string' ? peerRaw.role : undefined;
        if (peerRaw.role !== undefined && role === undefined) {
            throw stepFieldError(id, 'peer.role', 'a string');
        }
        const goals = peerRaw.goals;
        if (goals !== undefined) {
            if (!Array.isArray(goals) || goals.some((item) => typeof item !== 'string')) {
                throw stepFieldError(id, 'peer.goals', 'an array of strings');
            }
        }
        const grant = peerRaw.grant;
        if (grant !== undefined) {
            if (!Array.isArray(grant) || grant.some((item) => typeof item !== 'string')) {
                throw stepFieldError(id, 'peer.grant', 'an array of strings');
            }
        }
        const slot = typeof peerRaw.slot === 'string' ? peerRaw.slot : undefined;
        if (peerRaw.slot !== undefined && slot === undefined) {
            throw stepFieldError(id, 'peer.slot', 'a string');
        }
        const quorum = peerRaw.quorum;
        if (quorum !== undefined) {
            if (typeof quorum !== 'number' || !Number.isFinite(quorum) || quorum < 0) {
                throw stepFieldError(id, 'peer.quorum', 'a non-negative number');
            }
        }
        const heartbeatMs = peerRaw.heartbeatMs;
        if (heartbeatMs !== undefined) {
            if (typeof heartbeatMs !== 'number' || !Number.isFinite(heartbeatMs) || heartbeatMs < 0) {
                throw stepFieldError(id, 'peer.heartbeatMs', 'a non-negative number');
            }
        }
        const offlineGraceMs = peerRaw.offlineGraceMs;
        if (offlineGraceMs !== undefined) {
            if (typeof offlineGraceMs !== 'number' || !Number.isFinite(offlineGraceMs) || offlineGraceMs < 0) {
                throw stepFieldError(id, 'peer.offlineGraceMs', 'a non-negative number');
            }
        }
        const rejoin = peerRaw.rejoin;
        if (rejoin !== undefined) {
            if (rejoin !== 'resume' && rejoin !== 'replace' && rejoin !== 'reject') {
                throw stepFieldError(id, 'peer.rejoin', 'resume, replace, or reject');
            }
        }
        const open = peerRaw.open;
        if (open !== undefined && typeof open !== 'boolean') {
            throw stepFieldError(id, 'peer.open', 'a boolean');
        }
        step.peer = {
            ...(kind !== undefined ? { kind: kind } : {}),
            ...(jid !== undefined ? { jid } : {}),
            ...(role !== undefined ? { role } : {}),
            ...(Array.isArray(goals) ? { goals: goals } : {}),
            ...(Array.isArray(grant) ? { grant: grant } : {}),
            ...(open !== undefined ? { open } : {}),
            ...(slot !== undefined ? { slot } : {}),
            ...(typeof quorum === 'number' ? { quorum } : {}),
            ...(typeof heartbeatMs === 'number' ? { heartbeatMs } : {}),
            ...(typeof offlineGraceMs === 'number' ? { offlineGraceMs } : {}),
            ...(rejoin !== undefined ? { rejoin: rejoin } : {}),
        };
    }
    if (raw.ui !== undefined) {
        if (raw.ui === null || typeof raw.ui !== 'object' || Array.isArray(raw.ui)) {
            throw stepFieldError(id, 'ui', 'an object with numeric x/y');
        }
        const ui = raw.ui;
        if (typeof ui.x === 'number' && typeof ui.y === 'number') {
            step.ui = { x: ui.x, y: ui.y };
        }
        else {
            throw stepFieldError(id, 'ui', 'an object with numeric x/y');
        }
    }
    return step;
}
export async function parseWorkflow(content) {
    // Dynamic import for YAML parsing (ESM compatible)
    const yaml = await import('js-yaml');
    const doc = yaml.default.load(content);
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
        throw new Error('Workflow document must be a YAML mapping');
    }
    const root = doc;
    // Validate apiVersion (accept legacy alias used by early examples/UI)
    const apiVersion = typeof root.apiVersion === 'string' ? root.apiVersion : '';
    const normalizedApiVersion = WORKFLOW_API_VERSION_ALIASES.includes(apiVersion)
        ? WORKFLOW_API_VERSION
        : apiVersion;
    if (normalizedApiVersion !== WORKFLOW_API_VERSION) {
        throw new Error(`Unsupported apiVersion: ${root.apiVersion}`);
    }
    // Validate kind
    if (root.kind !== 'Workflow') {
        throw new Error(`Unsupported kind: ${root.kind}`);
    }
    // Parse metadata
    if (!root.metadata || typeof root.metadata !== 'object') {
        throw new Error('metadata is required');
    }
    const meta = root.metadata;
    if (typeof meta.name !== 'string') {
        throw new Error('metadata.name is required and must be a string');
    }
    const uid = typeof meta.uid === 'string' && meta.uid.trim()
        ? meta.uid.trim()
        : undefined;
    // Parse spec
    if (!root.spec || typeof root.spec !== 'object') {
        throw new Error('spec is required');
    }
    const spec = root.spec;
    if (!Array.isArray(spec.steps) || spec.steps.length === 0) {
        throw new Error('spec.steps must be a non-empty array');
    }
    // Parse steps
    const steps = spec.steps.map((raw) => {
        if (typeof raw.id !== 'string') {
            throw new Error('Each step must have an "id" string');
        }
        if (typeof raw.type !== 'string') {
            throw new Error(`Step "${raw.id}" must have a "type" string`);
        }
        if (!Object.values(StepType).includes(raw.type)) {
            throw new Error(`Step "${raw.id}" has invalid type: ${raw.type}`);
        }
        return normalizeStep(raw);
    });
    // Build Workflow object
    const workflow = {
        apiVersion: normalizedApiVersion,
        kind: root.kind,
        metadata: {
            name: meta.name,
            ...(uid ? { uid } : {}),
            ...(typeof meta.title === 'string' ? { title: meta.title } : {}),
            ...(typeof meta.description === 'string' ? { description: meta.description } : {}),
            ...(typeof meta.version === 'string' ? { version: meta.version } : {}),
            ...(meta.labels && typeof meta.labels === 'object' ? { labels: meta.labels } : {}),
            ...(Array.isArray(meta.requires)
                ? { requires: meta.requires.filter((r) => typeof r === 'string') }
                : {}),
        },
        spec: {
            ...(spec.trigger && typeof spec.trigger === 'object' ? { trigger: spec.trigger } : {}),
            ...(typeof spec.max_concurrency === 'number' ? { max_concurrency: spec.max_concurrency } : {}),
            ...(Array.isArray(spec.resources) ? { resources: spec.resources } : {}),
            steps,
        },
    };
    return workflow;
}
/** Serialize a workflow document to canonical YAML. */
export async function serializeWorkflow(workflow) {
    const yaml = await import('js-yaml');
    const doc = {
        ...workflow,
        apiVersion: WORKFLOW_API_VERSION,
        kind: 'Workflow',
    };
    return yaml.default.dump(doc, { lineWidth: 100, noRefs: true });
}
/** Local engine capability set — the preflight source for requires gating. */
export function engineCapabilities() {
    return {
        dslVersion: WORKFLOW_API_VERSION,
        stepTypes: Object.values(StepType),
        features: ['gate', 'compensation', 'sub_workflow', 'triggers', 'collab'],
    };
}
export function validateWorkflow(workflow) {
    const errors = [];
    const stepIds = new Set();
    const order = [];
    // Check metadata
    if (!workflow.metadata?.name) {
        errors.push({ path: 'metadata.name', message: 'Name is required', severity: 'error' });
    }
    else if (!/^[a-z0-9-]+$/.test(workflow.metadata.name)) {
        errors.push({ path: 'metadata.name', message: 'Name must be [a-z0-9-]+', severity: 'error' });
    }
    else if (workflow.metadata.name.length > 63) {
        errors.push({ path: 'metadata.name', message: 'Name must be <= 63 chars', severity: 'error' });
    }
    // Capability negotiation: requires must be satisfiable by this engine.
    // Unknown capabilities fail loudly (capability_missing) — never silently skip.
    const available = engineCapabilities();
    for (const cap of workflow.metadata?.requires ?? []) {
        if (!available.stepTypes.includes(cap) && !available.features.includes(cap)) {
            errors.push({
                path: 'metadata.requires',
                message: `Capability not available on this engine: ${cap} (platform-only types may still sync to AWF; see workflow_capabilities / the AWF /api/dsl/capabilities endpoint)`,
                severity: 'error',
                code: 'capability_missing',
            });
        }
    }
    // Resource declarations: only `concurrency` is enforced today.
    // Anything else is accepted for forward compatibility but has no runtime effect.
    for (const resource of workflow.spec.resources ?? []) {
        const isConcurrency = resource.name === 'concurrency' || resource.type === 'concurrency';
        if (!isConcurrency) {
            errors.push({
                path: 'spec.resources',
                message: `Resource "${resource.name ?? resource.type ?? '?'}" is declared but not enforced (only "concurrency" is implemented)`,
                severity: 'warning',
                code: 'resource_unenforced',
            });
        }
        else if (resource.limit !== undefined && (typeof resource.limit !== 'number' || !Number.isFinite(resource.limit) || resource.limit < 1)) {
            errors.push({
                path: 'spec.resources',
                message: `Resource "${resource.name ?? resource.type}" limit must be a positive number`,
                severity: 'error',
            });
        }
    }
    // Check steps
    if (!workflow.spec?.steps || workflow.spec.steps.length === 0) {
        errors.push({ path: 'spec.steps', message: 'At least one step is required', severity: 'error' });
        return { ok: errors.every((error) => error.severity !== 'error'), errors, order };
    }
    // Check for duplicate step IDs
    for (const step of workflow.spec.steps) {
        if (stepIds.has(step.id)) {
            errors.push({ path: `spec.steps.${step.id}`, message: 'Duplicate step ID', severity: 'error' });
        }
        stepIds.add(step.id);
    }
    // Check dependencies exist and detect cycles (Kahn's algorithm)
    const inDegree = new Map();
    const adj = new Map();
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
            }
            else {
                adj.get(dep).push(step.id);
                inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
            }
        }
    }
    // Kahn's algorithm for topological sort
    const queue = [];
    for (const [id, degree] of inDegree) {
        if (degree === 0)
            queue.push(id);
    }
    while (queue.length > 0) {
        const id = queue.shift();
        order.push(id);
        for (const next of adj.get(id) ?? []) {
            const newDegree = (inDegree.get(next) ?? 1) - 1;
            inDegree.set(next, newDegree);
            if (newDegree === 0)
                queue.push(next);
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
    return { ok: errors.every((error) => error.severity !== 'error'), errors, order };
}
function validateStep(step, errors) {
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
    // Shared field types (also covers programmatic construction that bypasses parseWorkflow).
    if (step.run !== undefined && typeof step.run !== 'string') {
        errors.push({ path: `${path}.run`, message: 'run must be a string', severity: 'error' });
    }
    if (step.timeout !== undefined && (typeof step.timeout !== 'number' || !Number.isFinite(step.timeout) || step.timeout < 0)) {
        errors.push({ path: `${path}.timeout`, message: 'timeout must be a non-negative number', severity: 'error' });
    }
    if (step.prompt !== undefined && typeof step.prompt !== 'string') {
        errors.push({ path: `${path}.prompt`, message: 'prompt must be a string', severity: 'error' });
    }
    if (step.question !== undefined && typeof step.question !== 'string') {
        errors.push({ path: `${path}.question`, message: 'question must be a string', severity: 'error' });
    }
    if (step.options !== undefined) {
        if (!Array.isArray(step.options) || step.options.some((o) => typeof o !== 'string')) {
            errors.push({ path: `${path}.options`, message: 'options must be an array of strings', severity: 'error' });
        }
    }
    if (step.pass !== undefined) {
        if (!Array.isArray(step.pass) || step.pass.some((p) => typeof p !== 'string')) {
            errors.push({ path: `${path}.pass`, message: 'pass must be an array of strings', severity: 'error' });
        }
    }
    if (step.ref !== undefined && typeof step.ref !== 'string') {
        errors.push({ path: `${path}.ref`, message: 'ref must be a string', severity: 'error' });
    }
    if (step.env !== undefined) {
        if (step.env === null || typeof step.env !== 'object' || Array.isArray(step.env)) {
            errors.push({ path: `${path}.env`, message: 'env must be a string mapping', severity: 'error' });
        }
    }
    if (step.maxTokens !== undefined && (typeof step.maxTokens !== 'number' || !Number.isFinite(step.maxTokens) || step.maxTokens < 0)) {
        errors.push({ path: `${path}.maxTokens`, message: 'maxTokens must be a non-negative number', severity: 'error' });
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
        case StepType.CollabPeer:
            if (!step.peer) {
                errors.push({ path: `${path}.peer`, message: 'Collab peer step requires "peer"', severity: 'error' });
                break;
            }
            if (!step.peer.kind) {
                errors.push({ path: `${path}.peer.kind`, message: 'Collab peer requires "peer.kind"', severity: 'error' });
            }
            else if (!['session', 'agent', 'workflow'].includes(step.peer.kind)) {
                errors.push({
                    path: `${path}.peer.kind`,
                    message: 'peer.kind must be session, agent, or workflow',
                    severity: 'error',
                });
            }
            if (step.peer.open === false) {
                if (!step.peer.jid) {
                    errors.push({
                        path: `${path}.peer.jid`,
                        message: 'Closed peer (open=false) requires "peer.jid"',
                        severity: 'error',
                    });
                }
            }
            else if (!step.peer.slot) {
                errors.push({
                    path: `${path}.peer.slot`,
                    message: 'Open peer requires "peer.slot"',
                    severity: 'error',
                });
            }
            if (step.peer.rejoin !== undefined
                && step.peer.rejoin !== 'resume'
                && step.peer.rejoin !== 'replace'
                && step.peer.rejoin !== 'reject') {
                errors.push({
                    path: `${path}.peer.rejoin`,
                    message: 'peer.rejoin must be resume, replace, or reject',
                    severity: 'error',
                });
            }
            break;
    }
    if (step.retries !== undefined) {
        if (typeof step.retries !== 'number' || !Number.isInteger(step.retries) || step.retries < 0) {
            errors.push({ path: `${path}.retries`, message: 'retries must be a non-negative integer', severity: 'error' });
        }
    }
    if (step.on_failure !== undefined
        && step.on_failure !== 'fail'
        && step.on_failure !== 'skip'
        && step.on_failure !== 'compensate') {
        errors.push({
            path: `${path}.on_failure`,
            message: 'on_failure must be fail, skip, or compensate',
            severity: 'error',
        });
    }
    // Validate compensation
    if (step.on_failure === 'compensate' && !step.compensation) {
        errors.push({ path, message: 'on_failure=compensate requires "compensation"', severity: 'error' });
    }
}
//# sourceMappingURL=models.js.map