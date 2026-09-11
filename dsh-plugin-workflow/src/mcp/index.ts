/**
 * MCP Server Entry Point
 * Standalone entry for running workflow MCP server
 */

import { WorkflowPlugin } from '../plugin.ts';

async function main() {
  const plugin = new WorkflowPlugin({
    mcpEnabled: true,
    mcpPort: parseInt(process.env.WORKFLOW_MCP_PORT ?? '18081'),
  });

  await plugin.init();
  await plugin.startMCP();
}

main().catch(console.error);
