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
    TaskStatus["Ready"] = "ready";
    TaskStatus["InProgress"] = "in_progress";
    TaskStatus["Blocked"] = "blocked";
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
        const step = raw;
        if (raw.ui && typeof raw.ui === 'object' && !Array.isArray(raw.ui)) {
            const ui = raw.ui;
            if (typeof ui.x === 'number' && typeof ui.y === 'number') {
                step.ui = { x: ui.x, y: ui.y };
            }
        }
        return step;
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
        features: ['gate', 'compensation', 'sub_workflow', 'triggers'],
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