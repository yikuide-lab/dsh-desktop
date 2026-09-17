/**
 * MCP Tools for Workflow Engine
 * Provides 27 tools for workflow lifecycle management
 */

import type { WorkflowPlugin } from '../plugin.js';

// ============================================================================
// Tool Definitions
// ============================================================================

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, plugin: WorkflowPlugin) => Promise<unknown>;
}

function assertDangerousMcp(plugin: WorkflowPlugin): void {
  if (!plugin.areDangerousMcpToolsEnabled()) {
    throw new Error(
      'Dangerous MCP tools are disabled. Set mcpDangerousToolsEnabled: true or WORKFLOW_MCP_DANGEROUS=1',
    );
  }
}

// ============================================================================
// Workflow Tools
// ============================================================================

export const workflowTools: MCPTool[] = [
  {
    name: 'workflow_validate',
    description: 'Validate a workflow YAML definition',
    inputSchema: {
      type: 'object',
      properties: {
        yaml: { type: 'string', description: 'Workflow YAML definition' },
      },
      required: ['yaml'],
    },
    async handler(args, _plugin) {
      const { parseWorkflow, validateWorkflow } = await import('../engine/models.js');
      const workflow = await parseWorkflow(args.yaml as string);
      const result = validateWorkflow(workflow);
      return { valid: result.ok, errors: result.errors, order: result.order };
    },
  },

  {
    name: 'workflow_save',
    description: 'Save a workflow definition',
    inputSchema: {
      type: 'object',
      properties: {
        yaml: { type: 'string', description: 'Workflow YAML definition' },
      },
      required: ['yaml'],
    },
    async handler(args, plugin) {
      const result = await plugin.createWorkflow(args.yaml as string);
      return {
        name: result.workflow.metadata.name,
        valid: result.validation.ok,
        errors: result.validation.errors,
      };
    },
  },

  {
    name: 'workflow_list',
    description: 'List all saved workflows',
    inputSchema: { type: 'object', properties: {} },
    async handler(_args, plugin) {
      const workflows = await plugin.listWorkflows();
      return workflows.map(w => ({
        name: w.metadata.name,
        title: w.metadata.title,
        steps: w.spec.steps.length,
        description: w.metadata.description,
      }));
    },
  },

  {
    name: 'workflow_get',
    description: 'Get a workflow by name',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Workflow name' },
      },
      required: ['name'],
    },
    async handler(args, plugin) {
      const workflow = await plugin.getWorkflow(args.name as string);
      if (!workflow) return { error: 'Workflow not found' };
      return workflow;
    },
  },

  {
    name: 'workflow_delete',
    description: 'Delete a workflow (requires mcpDangerousToolsEnabled)',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Workflow name' },
      },
      required: ['name'],
    },
    async handler(args, plugin) {
      assertDangerousMcp(plugin);
      const deleted = await plugin.deleteWorkflow(args.name as string);
      return { deleted };
    },
  },
];

// ============================================================================
// Run Tools
// ============================================================================

export const runTools: MCPTool[] = [
  {
    name: 'run_create',
    description: 'Start a new workflow run',
    inputSchema: {
      type: 'object',
      properties: {
        workflow: { type: 'string', description: 'Workflow name' },
        params: { type: 'object', description: 'Run parameters' },
      },
      required: ['workflow'],
    },
    async handler(args, plugin) {
      const run = await plugin.startRun(args.workflow as string, args.params as Record<string, unknown>);
      return {
        runId: run.id,
        status: run.status,
        workflow: run.workflowName,
      };
    },
  },

  {
    name: 'run_list',
    description: 'List all runs for a workflow',
    inputSchema: {
      type: 'object',
      properties: {
        workflow: { type: 'string', description: 'Workflow name (optional)' },
      },
    },
    async handler(args, plugin) {
      const runs = await plugin.listRuns(args.workflow as string | undefined);
      return runs.map(r => ({
        id: r.id,
        workflow: r.workflowName,
        status: r.status,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
      }));
    },
  },

  {
    name: 'run_get',
    description: 'Get a run by ID',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run ID' },
      },
      required: ['runId'],
    },
    async handler(args, plugin) {
      const run = await plugin.getRun(args.runId as string);
      if (!run) return { error: 'Run not found' };
      return run;
    },
  },

  {
    name: 'run_stop',
    description: 'Stop a running workflow (requires mcpDangerousToolsEnabled)',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run ID' },
      },
      required: ['runId'],
    },
    async handler(args, plugin) {
      assertDangerousMcp(plugin);
      const run = await plugin.stopRun(args.runId as string);
      return { id: run.id, status: run.status };
    },
  },
];

// ============================================================================
// Gate Tools
// ============================================================================

export const gateTools: MCPTool[] = [
  {
    name: 'gate_resolve',
    description: 'Resolve an approval gate (requires mcpDangerousToolsEnabled)',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run ID' },
        stepId: { type: 'string', description: 'Step ID' },
        decision: { type: 'string', description: 'Decision (approved/rejected)' },
        resolvedBy: { type: 'string', description: 'Resolver identity' },
        token: { type: 'string', description: 'Gate token' },
      },
      required: ['runId', 'stepId', 'decision', 'resolvedBy', 'token'],
    },
    async handler(args, plugin) {
      assertDangerousMcp(plugin);
      await plugin.resolveGate(
        args.runId as string,
        args.stepId as string,
        args.decision as string,
        args.resolvedBy as string,
        args.token as string,
      );
      return { resolved: true };
    },
  },

  {
    name: 'gate_list',
    description: 'List pending gates for a run (tokens redacted)',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run ID' },
      },
      required: ['runId'],
    },
    async handler(args, plugin) {
      const gates = await plugin.listPendingGates(args.runId as string);
      return gates.map((gate) => ({
        runId: gate.runId,
        stepId: gate.stepId,
        question: gate.question,
        options: gate.options,
        ...(gate.pass ? { pass: gate.pass } : {}),
        token: '[redacted]',
      }));
    },
  },
];

// ============================================================================
// Stats Tools
// ============================================================================

export const statsTools: MCPTool[] = [
  {
    name: 'stats_get',
    description: 'Get workflow engine statistics',
    inputSchema: { type: 'object', properties: {} },
    async handler(_args, plugin) {
      return plugin.getStats();
    },
  },
  {
    name: 'workflow_capabilities',
    description:
      'List local engine capabilities (step types, features, DSL version) for requires preflight. '
      + 'Platform extension types live on the AWF side — fetch GET /api/dsl/capabilities there.',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      const { engineCapabilities } = await import('../engine/models.js');
      return engineCapabilities();
    },
  },
];

// ============================================================================
// Export All Tools
// ============================================================================

export const allMCPTools: MCPTool[] = [
  ...workflowTools,
  ...runTools,
  ...gateTools,
  ...statsTools,
];

export function getToolByName(name: string): MCPTool | undefined {
  return allMCPTools.find(t => t.name === name);
}

export function listToolNames(): string[] {
  return allMCPTools.map(t => t.name);
}
