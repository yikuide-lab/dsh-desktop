# DSH Workflow Plugin

Workflow engine plugin for DSH Desktop - visual workflow designer and execution engine.

## Features

- **YAML DSL**: Declarative workflow definition with script / task / llm / approval / sub_workflow steps
- **Visual Designer**: Desktop React canvas (read-only preview + editable designer)
- **Execution Engine**: Multi-run coordinators with per-run step concurrency, per-step dispatch time limits (script default 600s / configurable heartbeat ceiling), and serialized ticks
- **Nested workflows**: `sub_workflow` starts a child run and waits synchronously
- **Approval Gates**: Human-in-the-loop approval with configurable pass decisions; offline resolve reattaches the coordinator
- **Compensation**: Rollback support for failed steps
- **Transcripts**: Append-only `runs/<id>.transcript.jsonl` interaction logs for tracking/improvement
- **Triggers**: Cron / event / manual triggers with filter expressions; Desktop Triggers tab + `triggers.json` persistence
- **Retention**: Configurable run retention + purge/export APIs
- **Script policy**: `allow` | `workspace-only` | `deny` (cwd jail under `WORKSPACE_ROOT`)

> Concurrent runs are capped by `maxActiveRuns` (default 4). Nested `sub_workflow` runs count toward that budget and inherit workspace params; stopping a parent aborts its children.
> Run documents use `schemaVersion` (currently `1`). Desktop HTTP API version is `DESKTOP_WORKFLOW_API_VERSION`.

## Installation

```bash
# From DSH Desktop plugin directory
cd dsh-plugin-workflow
npm install
npm run build
```

## Usage

### Create a Workflow

```yaml
apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: my-workflow
  title: My Workflow
spec:
  max_concurrency: 4
  steps:
    - id: step1
      type: script
      run: echo hello
    
    - id: step2
      type: task
      deps: [step1]
      inputs:
        target: "src/"
      outputs:
        - "report.md"
      acceptance:
        - "All tests pass"
    
    - id: step3
      type: approval
      deps: [step2]
      question: "Approve changes?"
      options: [approved, rejected]
```

### Step Types

| Type | Description | Key Fields |
|------|-------------|------------|
| `script` | Shell command execution | `run`, `env`, `timeout` |
| `task` | Code agent task | `inputs`, `outputs`, `acceptance`, `role` |
| `llm` | LLM model call | `prompt`, `role` |
| `approval` | Human approval gate | `question`, `options`, `pass` |
| `sub_workflow` | Nested workflow (sync child run) | `ref` |

### API

```typescript
import { WorkflowPlugin } from 'dsh-plugin-workflow';

const plugin = new WorkflowPlugin({ stateDir: '~/.dsh/workflow' });
await plugin.init();

// Create workflow
await plugin.createWorkflow(yamlString);

// Start run
const run = await plugin.startRun('my-workflow', { branch: 'main' });

// Resolve approval gate
await plugin.resolveGate(run.id, 'approve', 'approved', 'user-1', gateToken);
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Type check
npm run typecheck

# Run tests
npm test
```

## MCP Integration

The workflow engine exposes **12** MCP tools for AI agent integration:

```bash
# Start MCP server in stdio mode
dsh-workflow

# Or via npm
npm run mcp
```

### Available MCP Tools

| Category | Tools |
|----------|-------|
| **Workflow** | `workflow_validate`, `workflow_save`, `workflow_list`, `workflow_get`, `workflow_delete` |
| **Run** | `run_create`, `run_list`, `run_get`, `run_stop` |
| **Gate** | `gate_resolve`, `gate_list` |
| **Stats** | `stats_get` |

### Example MCP Call

```json
{
  "method": "tools/call",
  "params": {
    "name": "run_create",
    "arguments": {
      "workflow": "code-review",
      "params": { "branch": "main" }
    }
  }
}
```

## Triggers

Cron / event / manual triggers are available on `WorkflowPlugin` when constructed with
`triggersEnabled: true` (plugin default **false**; **Desktop Host defaults to true**).

Desktop UI exposes trigger management on the **Triggers** tab (cron / event / manual, filter `path=value` clauses). Triggers persist to `triggers.json` when enabled.

### Cron Triggers

```typescript
plugin.addTrigger({
  type: 'cron',
  schedule: '0 9 * * *',  // Every day at 9am
  workflowName: 'daily-report',
});
```

### Event Triggers

```typescript
plugin.addTrigger({
  type: 'event',
  source: 'git',
  on: 'push',
  workflowName: 'code-review',
});
```

### Manual Triggers

```typescript
plugin.fireEvent('manual', 'deploy', { version: '1.0.0' });
```

## Architecture

```
dsh-plugin-workflow/
├── src/
│   ├── engine/
│   │   ├── models.ts      # Type definitions
│   │   ├── engine.ts      # State transitions
│   │   ├── coordinator.ts # Execution coordinator
│   │   ├── executor.ts    # Script + Host hooks
│   │   └── store.ts       # File persistence
│   ├── mcp/
│   │   ├── server.ts      # MCP server
│   │   ├── tools.ts       # Tool definitions (12 tools)
│   │   └── index.ts       # Entry point
│   ├── triggers/
│   │   └── trigger.ts     # Cron/Event triggers (opt-in)
│   └── plugin.ts          # DSH plugin entry
├── ui-legacy/             # Archived static prototypes (unused by Desktop)
└── examples/
    ├── code-review.yaml
    └── deploy-pipeline.yaml
```

## License

MIT
