/**
 * MCP Server for Workflow Engine
 * Exposes workflow tools via MCP protocol
 */
import { createInterface } from 'node:readline';
import { allMCPTools, getToolByName } from './tools.js';
// ============================================================================
// MCP Server
// ============================================================================
export class MCPServer {
    plugin;
    readline = null;
    constructor(plugin) {
        this.plugin = plugin;
    }
    /**
     * Start the MCP server in stdio mode
     */
    async startStdio() {
        this.readline = createInterface({
            input: process.stdin,
            terminal: false,
        });
        this.readline.on('line', async (line) => {
            try {
                const request = JSON.parse(line);
                const response = await this.handleRequest(request);
                process.stdout.write(JSON.stringify(response) + '\n');
            }
            catch (error) {
                const response = {
                    jsonrpc: '2.0',
                    error: {
                        code: -32700,
                        message: 'Parse error',
                    },
                };
                process.stdout.write(JSON.stringify(response) + '\n');
            }
        });
        this.readline.on('close', () => {
            process.exit(0);
        });
    }
    /**
     * Handle an MCP request
     */
    async handleRequest(request) {
        const { id, method, params } = request;
        try {
            let result;
            switch (method) {
                case 'initialize':
                    result = this.handleInitialize();
                    break;
                case 'tools/list':
                    result = this.handleToolsList();
                    break;
                case 'tools/call':
                    result = await this.handleToolsCall(params);
                    break;
                case 'ping':
                    result = {};
                    break;
                default:
                    return {
                        jsonrpc: '2.0',
                        id,
                        error: {
                            code: -32601,
                            message: `Method not found: ${method}`,
                        },
                    };
            }
            return {
                jsonrpc: '2.0',
                id,
                result,
            };
        }
        catch (error) {
            return {
                jsonrpc: '2.0',
                id,
                error: {
                    code: -32603,
                    message: error instanceof Error ? error.message : 'Internal error',
                },
            };
        }
    }
    /**
     * Handle initialize request
     */
    handleInitialize() {
        return {
            protocolVersion: '2024-11-05',
            capabilities: {
                tools: {},
            },
            serverInfo: {
                name: 'dsh-workflow',
                version: '0.1.0',
            },
        };
    }
    /**
     * Handle tools/list request
     */
    handleToolsList() {
        return {
            tools: allMCPTools.map(tool => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
            })),
        };
    }
    /**
     * Handle tools/call request
     */
    async handleToolsCall(params) {
        const name = params?.name;
        const args = params?.arguments ?? {};
        const tool = getToolByName(name);
        if (!tool) {
            throw new Error(`Tool not found: ${name}`);
        }
        const result = await tool.handler(args, this.plugin);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }
    /**
     * Stop the server
     */
    stop() {
        this.readline?.close();
    }
}
// ============================================================================
// Standalone Entry Point
// ============================================================================
export async function startMCPServer(plugin) {
    const server = new MCPServer(plugin);
    await server.startStdio();
}
//# sourceMappingURL=server.js.map