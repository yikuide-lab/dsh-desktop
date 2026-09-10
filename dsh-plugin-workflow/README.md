# DSH Workflow Plugin

Workflow engine plugin for DSH Desktop - visual workflow designer and execution engine.

## Features

- **YAML DSL**: Declarative workflow definition with 5 step types
- **Visual Designer**: Drag-and-drop workflow builder (coming soon)
- **Execution Engine**: State machine with coordination and concurrency control
- **Approval Gates**: Human-in-the-loop approval workflow
- **Sub-workflows**: Nested workflow execution
- **Compensation**: Rollback support for failed steps

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
apiVersion: wfwise.io/v1
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
| `approval` | Human approval gate | `question`, `options` |
| `sub_workflow` | Nested workflow | `ref` |

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

## Architecture

```
dsh-plugin-workflow/
├── src/
│   ├── engine/
│   │   ├── models.ts      # Type definitions
│   │   ├── engine.ts      # State transitions
│   │   ├── coordinator.ts # Execution coordinator
│   │   └── store.ts       # File persistence
│   ├── plugin.ts          # DSH plugin entry
│   └── hooks/             # React hooks (future)
├── ui/
│   ├── workflow-panel.html
│   └── app.js
└── examples/
    ├── code-review.yaml
    └── deploy-pipeline.yaml
```

## License

MIT
