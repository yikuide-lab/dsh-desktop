#!/usr/bin/env node
/**
 * MCP Server Entry Point
 * Standalone entry for running workflow MCP server (stdio).
 */
import { WorkflowPlugin } from '../plugin.js';
async function main() {
    const plugin = new WorkflowPlugin({
        mcpEnabled: true,
        mcpDangerousToolsEnabled: process.env.WORKFLOW_MCP_DANGEROUS === '1',
    });
    await plugin.init();
    await plugin.startMCP();
}
main().catch(console.error);
//# sourceMappingURL=index.js.map