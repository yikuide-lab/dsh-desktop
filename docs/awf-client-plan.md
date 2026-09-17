# DSH Workflow 插件 × AWF 平台：客户端侧实施计划（文件级）

> 日期：2026-09-17 · 对应 AWF 仓库 beads：awf-9zy（C-P1）/ awf-0bx（C-P2）/ awf-66p（C-P3）/ awf-a3c（C-P4 部分）
> 总模式与双端路线图见 AWF 仓库 `docs/DSH_CLIENT_PLAN.md`（集成模式 §1、能力不变式、平台轨道已落地：
> `GET /api/dsl/capabilities`、`POST /api/sync/validate`、sub_workflow 真嵌套均已上线并有测试）。
> 本文是客户端轨道在该仓库的落地细化，遵守本仓库规则：**功能先在 `dsh-plugin-desktop-beta/`
> 开发验证，再同步 `dsh-plugin-desktop/`，提交前跑 `corepack yarn check` 与
> `check:desktop-variants`**；一切保持 headless-safe。

---

## 0. 已确认的事实基础

- 两端同源：本仓库 `dsh-plugin-desktop/src/client/WorkflowCanvas.tsx`、`WorkflowAiDesignPanel.tsx`
  与 AWF 前端组件同名同构；DSL 同为 `workflow-wise/v1`。
- 桌面已有 OpenAI 兼容网关先例（`desktop-workflow-openai-*.ts`，settings 0600 落
  `~/.dsh/workflow/openai-api.json`，UI 只显 key 指纹）——AWF 连接器完全复用这套模式。
- 平台侧对接面（已上线，见 AWF `docs/API.md` 能力边界节）：
  - `GET /api/dsl/capabilities`（匿名）——能力预检
  - `POST /api/sync/validate`（JWT）——推送预检（逐项 YAML 错误 + 发布冻结冲突）
  - `POST /api/sync/workflows`（JWT，按 name upsert，已发布冻结 409）/ `GET /api/sync/workflows`
  - `POST /api/workflows/{id}/runs`、`/publish`、`/api/services/by-workflow/*`
- 凭据约束（安全红线）：**源码、示例、测试中永不出现可用凭据字面量**；
  token 默认读环境变量 `AWF_API_TOKEN`，用户显式保存时落 0600 的 `~/.dsh/awf.json`
  （与 openai-api.json 同级防护），UI/日志只显指纹。

---

## 1. C-P1 连接器与 Sync 推拉（awf-9zy）

### 新增文件（beta 先行，两侧同名镜像）

| 文件 | 职责 |
|------|------|
| `dsh-plugin-desktop-beta/src/desktop-awf-settings.ts` | `AwfSettings{baseUrl, apiTokenEnv, apiToken?}`；仿 `desktop-workflow-openai-settings.ts`：`defaultAwfSettings()` / `awfSettingsPath(stateDir)`（`~/.dsh/awf.json`，0600）/ `tokenFingerprint()`；读取优先级 env `AWF_API_TOKEN` > 显式保存值 |
| `dsh-plugin-desktop-beta/src/desktop-awf-client.ts` | 平台 API 客户端：`checkConnection()`（/health + /api/auth/me）、`capabilities()`、`syncValidate(items)`、`syncPush(items)`、`syncPull()`、`createRun(id, params)`、`getRun(id, runId)`、`publish(id)`、`createService(...)`。错误分类 `network / auth(401) / validation(400 明细) / conflict(409)` |
| `dsh-plugin-desktop-beta/tests/awf-client.spec.ts` | vitest + mock fetch：四类错误的分类断言；推送/拉取用例；token 指纹不回显 |

### 改动文件

- `desktop-workflow-controller.ts`：注入 awf client；新增动作 `syncToAwf(workflowName)`：
  组装 YAML → `syncValidate` →（冲突则提示走 new-version 流程）→ `syncPush` → 回执摘要。
- `src/client/desktop-workflow-api.ts`：暴露 IPC 面（连接测试/同步/拉取）。
- `src/client/locales-workflow.ts`：文案（中英）。
- designer 工具栏（`WorkflowCanvas.tsx` 同源面板）：「同步到 AWF」按钮 + AWF 设置区
  （baseUrl、token env 名、连接状态徽标、指纹）。

### 验收（awf-9zy）

- 断网回归：本地全部功能不受影响（现有测试全绿）。
- `corepack yarn check`（beta）+ `check:desktop-variants` 后同步 stable，双包绿。
- 联调：对运行中的 AWF（`scripts/smoke.sh` 同一套服务）完成 推送→预检→拉取 闭环。

## 2. C-P3 能力协商与类型阻断（awf-66p，先于 C-P2 做更稳）

- `dsh-plugin-workflow/src/plugin.ts`：
  - validate 钩子读取 `metadata.requires`，与本地引擎能力集比对，缺失 → 校验错误
    `capability_missing`（与平台同码，便于双端同一错误语义）。
  - 新增 `engineCapabilities()` 导出（本地可执行类型集合 + 特性开关），供 UI 与 MCP 使用；
    在线模式下用 `GET /api/dsl/capabilities` 刷新缓存（离线用内置快照 + 上次缓存）。
- `dsh-plugin-workflow/lib/mcp/tools.ts`：新增 `workflow_capabilities` 工具。
- designer/面板：含平台扩展类型（bloom/entity/mcp/…）的工作流标「仅平台可运行」，
  运行按钮阻断并列缺失能力；「同步到 AWF」不受阻断（平台具备这些能力）。
- 测试 `dsh-plugin-workflow/tests/capability-gate.spec.ts`：bloom 阻断、requires 命中、
  平台类型工作流仍可同步。

## 3. C-P2 远程运行互通（awf-0bx）

- `desktop-workflow-executor.ts`：执行位置枚举 `local | awf`；awf 模式调
  `createRun` + 轮询 `getRun`，结果映射回本地 Run 视图（复用 transcript 记录调用来源）。
- gate 对齐：平台 `waiting_gate` 的 run 在本地面板 resolve（走 AWF 既有 gate 端点语义；
  若平台未暴露 API-key 版 gate resolve，先在 AWF 增补——已在 AWF 计划 S-P1 备注内）。
- MCP：`awf_run_create` / `awf_run_get` 两个工具（凭据走 settings，不进工具参数）。
- 测试 `tests/awf-remote-run.spec.ts` + 双跑一致性 `tests/golden-parity.spec.ts`
  （基础 5 类型 golden YAML：本地真实跑 × 平台 mock 响应，断言输出语义一致）。

## 4. C-P4 反向网关治理与遥测（awf-a3c 客户端部分）

- `desktop-workflow-openai-settings.ts`：默认 `bindHost` 收敛为 `127.0.0.1`
  （行为变更：beta 先行 + 设置迁移提示 + 文档注明「开放局域网需显式确认」；
  `isLoopbackHost()` 已有，可直接用作默认值判定）。
- 遥测（默认关闭）：run 结束上报摘要至 `POST /api/telemetry/runs`
  （仅 工作流名/步骤状态/token 估算/耗时；**不含 prompt 与输出**）；
  AWF 侧端点属 awf-a3c 平台部分，未上线前客户端只做开关与本地缓存。

## 5. 流程门禁（每期相同）

```bash
# beta 开发
corepack yarn workspace dsh-plugin-desktop-beta check
corepack yarn check            # 根全量门禁（含双 desktop 变体）
# 同步 stable 前
corepack yarn check:desktop-variants
# 联调（AWF 仓库侧）
cd ~/Documents/ai-dev/ai-workflow-dev && ./scripts/smoke.sh   # 23 项平台基线
```

提交纪律：beta 与 stable 的同步独立成提交；不与上游 submodule pin 更新混合
（本仓库 AGENTS.md 既定规则）。

## 6. 依赖与顺序

```
awf-9zy (C-P1 连接器) ──► awf-0bx (C-P2 远程运行)
        │                        │
        └──► awf-66p (C-P3 协商) ─┘   （C-P3 只依赖平台 capabilities，已上线，可与 C-P1 并行）
awf-a3c (C-P4) 依赖 C-P2
```
