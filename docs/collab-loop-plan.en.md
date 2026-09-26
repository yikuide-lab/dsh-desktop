# Collab Loop (English summary)

> Date: 2026-09-26 · **Canonical full plan (zh):** [`collab-loop-plan.md`](./collab-loop-plan.md)  
> Do not maintain a parallel Cursor/local plan. AWF bridge: sibling repo `ai-workflow-dev/docs/COLLAB_BRIDGE.md`.  
> Related: [`awf-client-plan.md`](./awf-client-plan.md) §8 · [`time-master-plan.md`](./time-master-plan.md)

## Status

**V1 implementation landed** (2026-09-26): core, engine `collab_peer`, stability, admin API, healer/planner, UI, AWF remote guard, beta↔desktop sync. See Chinese plan todos (all `completed`).

**V2 slice landed** (2026-09-26): AspBridge in-process loopback + Host `asp.status`/`asp.setMode`; deputy fine-grained ACL; heal auto policy via `admin.updateControl`; controlled remote session/agent gate (`allowRemotePeers`, no fake remote).

**V2 follow-up** (2026-09-26): optional DID fields; CollabPanel Control tab; `TcpFramedAspBridge` with ASP protobuf framing (`AgentStreamMessage`), `tls://` endpoints, optional PLAIN auth (`DSH_COLLAB_ASP_*`). Still **pending**: Windows packaging.

## Decisions (locked)

- **ASP-shaped** coordination on Desktop Host (JID, Message/Presence/IQ, CapToken, CollabVision). No Rust ASP / Python SDK in V1; `AspBridge` later.
- One step type: `collab_peer` (`session` | `agent` | `workflow`). Remote **workflow only** via AWF `remoteRun`. Remote session/agent: explicit reject.
- Open membership + Stability (hard) + NetworkHealer AI proposals (soft; default approve-before-apply).
- LoopAdmin control plane; TaskPlanner can assign / invite / `spawnBranch`.
- Collab state **never** lands in AWF DB. Sync must not push graphs containing `collab_peer`.

## AWF boundary (P7)

```
sync/push clean YAML → createRun(auto_approve: false) → poll → waiting_gate →
  resolveGate(runnerUUID) as JWT owner only
```

Local collab gates reuse Desktop `resolveGate`; they are **not** AWF gates. Tunnel/Executor is the reverse direction and must not fake `remote.workflow`.

## Package split

| Layer | Owns |
| --- | --- |
| `dsh-plugin-workflow/src/collab/` | Pure Node bus, roster, vision, tokens, membership, heal/plan apply helpers |
| Engine | `StepType.collab_peer`, collab gate, `features: collab` |
| `dsh-plugin-desktop-beta` | `/api/desktop/collab`, host ticks, LLM, hooks, UI; then sync to `dsh-plugin-desktop` |

## Phases

P0 core → P1 `collab_peer` + local gate → P2 Stability → P3 Admin API → P4 Healer → P5 TaskPlanner → P6 template/UI → P7 AWF remote lifecycle → P8 beta→desktop variants.

## Read next

Full schemas, HTTP ops, JID table, verification, and A1–A5 AWF companion work: **[collab-loop-plan.md](./collab-loop-plan.md)**.
