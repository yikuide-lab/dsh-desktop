/**
 * MCP Tools for Workflow Engine
 * Provides 27 tools for workflow lifecycle management
 */
import type { WorkflowPlugin } from '../plugin.js';
export interface MCPTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    handler: (args: Record<string, unknown>, plugin: WorkflowPlugin) => Promise<unknown>;
}
export declare const workflowTools: MCPTool[];
export declare const runTools: MCPTool[];
export declare const gateTools: MCPTool[];
export declare const statsTools: MCPTool[];
export declare const allMCPTools: MCPTool[];
export declare function getToolByName(name: string): MCPTool | undefined;
export declare function listToolNames(): string[];
//# sourceMappingURL=tools.d.ts.map