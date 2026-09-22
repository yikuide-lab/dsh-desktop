# awf-runner — headless AWF node runner (`awf-node`)

Runs an [AWF platform](https://github.com/anywhere-labs/deepseek-harness-desktop) executor node without Electron: registers with the platform, long-polls for claimed executor tasks, executes them on the local `dsh-plugin-workflow` engine, and posts results back.

This package is also the **canonical pure-Node home** of the shared AWF modules consumed by the desktop plugins (`dsh-plugin-desktop` / `dsh-plugin-desktop-beta` re-export them from `src/desktop-awf-*.ts`):

| Subpath | Contents |
| --- | --- |
| `awf-runner/awf-settings` | platform connection settings (`awf.json`, env-token chain) |
| `awf-runner/awf-client` | classified REST client (sync / runs / publish / telemetry) |
| `awf-runner/awf-auth` | account session (register / login / refresh / logout) |
| `awf-runner/awf-executor` | register → claim → execute → result loop + heartbeat |
| `awf-runner/node-hooks` | OpenAI-compatible `DesktopExecutorHooks` for llm/task steps |
| `awf-runner/serve` | the `serve` orchestration used by the CLI |

## Usage

```bash
awf-node serve --platform https://awf.example.com \
  [--token-env AWF_API_TOKEN] [--concurrency 1] [--labels region=eu,...] \
  [--state-dir ~/.awf-node] [--claim-wait-sec 25]

awf-node login    --platform <url> --email <email> [--password <pw>]
awf-node register --platform <url> --email <email> [--password <pw>] [--display-name <name>]
awf-node status   [--state-dir DIR]
```

Environment: `AWF_PLATFORM_URL`, `AWF_NODE_STATE_DIR`, `AWF_API_TOKEN` (or the env var named by `--token-env`), `AWF_NODE_PASSWORD`, and the LLM endpoint trio below.

## State layout

```
<state-dir>/awf.json            platform connection (0600)
<state-dir>/awf-auth.json       login session, if `awf-node login` was used (0600)
<state-dir>/awf-executor.json   executor id + token from registration (0600)
<state-dir>/workflow/           engine state (runs, transcripts)
```

The platform user token is needed once for `POST /api/executors/register`; afterwards the persisted executor token drives claim / heartbeat / result.

## LLM / task steps

`script` steps run standalone (spawned shell). `llm` and `task` steps need an OpenAI-compatible chat-completions endpoint:

```bash
export AWF_NODE_LLM_BASE_URL=https://api.openai.com/v1   # any compatible endpoint
export AWF_NODE_LLM_API_KEY=...                          # optional for local endpoints
export AWF_NODE_LLM_MODEL=gpt-4o-mini                    # default model
```

`task` steps collapse the desktop agent session into a single completion (no tool-using loop on a headless node); acceptance criteria, inputs, and requested outputs are carried in the prompt exactly as on the desktop path. Without the endpoint configured, llm/task steps fail honestly instead of pretending.

## Deployment

- `Dockerfile` — `docker build -f awf-runner/Dockerfile -t awf-node .` from the repo root
- `../deploy/awf-node.service` — systemd unit template
- `../deploy/cloud-init.yaml` — VPS bootstrap (NodeSource Node 24 → build → env file → systemd)

## Development

```bash
corepack yarn workspace awf-runner build
corepack yarn workspace awf-runner test
corepack yarn workspace awf-runner typecheck
```
