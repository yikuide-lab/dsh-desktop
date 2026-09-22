#!/usr/bin/env node
/** awf-node executable entry (see ./cli.js for parsing and commands). */
import { main } from './cli.js';
main().catch((error) => {
    console.error(`awf-node: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
//# sourceMappingURL=bin.js.map