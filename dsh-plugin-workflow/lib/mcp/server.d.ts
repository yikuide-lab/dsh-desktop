/**
 * MCP Server for Workflow Engine
 * Exposes workflow tools via MCP protocol
 */
import type { WorkflowPlugin } from '../plugin.js';
interface MCPRequest {
    jsonrpc: '2.0';
    id?: number | string;
    method: string;
    params?: Record<string, unknown>;
}
interface MCPResponse {
    jsonrpc: '2.0';
    id?: number | string;
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}
export declare class MCPServer {
    private plugin;
    private readline;
    constructor(plugin: WorkflowPlugin);
    /**
     * Start the MCP server in stdio mode
     */
    startStdio(): Promise<void>;
    /**
     * Handle an MCP request
     */
    handleRequest(request: MCPRequest): Promise<MCPResponse>;
    /**
     * Handle initialize request
     */
    private handleInitialize;
    /**
     * Handle tools/list request
     */
    private handleToolsList;
    /**
     * Handle tools/call request
     */
    private handleToolsCall;
    /**
     * Stop the server
     */
    stop(): void;
}
export declare function startMCPServer(plugin: WorkflowPlugin): Promise<void>;
export {};
//# sourceMappingURL=server.d.ts.map