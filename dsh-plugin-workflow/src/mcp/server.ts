/**
 * MCP Server for Workflow Engine
 * Exposes workflow tools via MCP protocol
 */

import { createInterface } from 'node:readline';
import type { WorkflowPlugin } from '../plugin.js';
import { allMCPTools, getToolByName } from './tools.js';

// ============================================================================
// MCP Protocol Types
// ============================================================================

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

// ============================================================================
// MCP Server
// ============================================================================

export class MCPServer {
  private plugin: WorkflowPlugin;
  private readline: ReturnType<typeof createInterface> | null = null;

  constructor(plugin: WorkflowPlugin) {
    this.plugin = plugin;
  }

  /**
   * Start the MCP server in stdio mode
   */
  async startStdio(): Promise<void> {
    this.readline = createInterface({
      input: process.stdin,
      terminal: false,
    });

    this.readline.on('line', async (line) => {
      try {
        const request = JSON.parse(line) as MCPRequest;
        const response = await this.handleRequest(request);
        process.stdout.write(JSON.stringify(response) + '\n');
      } catch (error) {
        const response: MCPResponse = {
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
  async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    const { id, method, params } = request;

    try {
      let result: unknown;

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
    } catch (error) {
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
  private handleInitialize(): unknown {
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
  private handleToolsList(): unknown {
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
  private async handleToolsCall(params?: Record<string, unknown>): Promise<unknown> {
    const name = params?.name as string;
    const args = (params?.arguments as Record<string, unknown>) ?? {};

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
  stop(): void {
    this.readline?.close();
  }
}

// ============================================================================
// Standalone Entry Point
// ============================================================================

export async function startMCPServer(plugin: WorkflowPlugin): Promise<void> {
  const server = new MCPServer(plugin);
  await server.startStdio();
}
