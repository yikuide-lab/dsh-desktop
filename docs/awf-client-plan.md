# DSH Workflow 插件 × AWF 平台：客户端侧实施计划（文件级）

> 日期：2026-09-17 · 对应 AWF 仓库 beads：awf-9zy（C-P1）/ awf-0bx（C-P2）/ awf-66p（C-P3）/ awf-a3c（C-P4 部分）

---

## ✅ 整合收尾完成（2026-09-17 第二轮执行）

| 收尾步骤 | 状态 | 证据 |
|----------|------|------|
| 1 落地功能分支 | ✅ | `7edc614`（beta workflow 功能 68 文件，含 awf 全部接线） |
| 2 beta→stable 变体同步 | ✅ | `8de1e03`（awf 五件套+接线入 stable；verify-desktop-variants 230 文件对齐） |
| 3 awf-0bx | ✅ | 同步后发布冻结（publish-after-sync）+ 远程试运行表单 + `awf-golden-parity.spec.ts`（真实双跑 5/5：同一 YAML 本地引擎与平台输出含同一 echo token） |
| 4 awf-66p designer UX | ✅ | `414fbff`：platformOnlySteps 门禁——运行按钮禁用+提示列出平台扩展类型；同步不受阻；双包 4 用例 |
| 5 awf-a3c | ✅ 2026-09-17 第三轮（客户端部分） | 8787 网关默认 `127.0.0.1`（非回环警示文案）+ 遥测开关（默认关→零出站请求；run 摘要上报，失败入 0600 本地待发队列有界补发）+ desktop-executor PoC 客户端（注册/心跳/认领/经宿主真实 agent 执行/回传，凭据 0600）。平台侧 S-P4（`POST /api/telemetry/runs`、webhook HMAC 触发、executor 注册/认领/超时回收）同期交付；awf 仓库 smoke 34 项、pytest 117 项全绿 |

门禁终态：双包 typecheck 0 错误；awf 测试双包各 23 项（22 过 + parity 按环境跳过/真实跑过）；
verify-desktop-variants 230 对齐；既有 10 个 Linux-WIP 失败与本整合无关（未触碰）。
**整合判据达成**：stable 包源码包含完整 AWF 客户端 + 双包门禁绿 + 通道①②③各有真实端到端用例 + 能力协商 UX 生效。
残余说明：服务化向导的 API Key 签发 UI 仍需在平台侧操作（sync+publish 已自动化前两环）。
通道⑤遥测与执行器 PoC 已于第三轮交付（见上表 awf-a3c 行）。
客户端账号（2026-09-18 第四轮）：设置面板直接注册/登录 AWF（邮箱+密码、手机验证码；微信登录待平台配置
微信开放平台应用后开放，客户端如实置灰）；会话落 `~/.dsh/awf-auth.json`（0600，仅 refresh token，密码绝不落盘），
access token 临期自动刷新、401 自动重试一次；token 解析链 env > 手动保存 > 登录会话——「先去平台复制 token」的
手工步骤不再必要。

---

## 整合状态检查（2026-09-19 更新：**已整合，生产实测闭环**）

> 2026-09-17 的「未完全整合」结论与 gap-closure 计划见下节（保留供追溯）。收尾已于 2026-09-17/18 完成：
> ①功能分支落地 ②stable 变体同步（verify-desktop-variants 234 对齐）③awf-0bx ④awf-66p ⑤awf-a3c ⑥桌面账号注册/登录。
>
> **2026-09-19 生产验证（平台 https://awf.seedwill.com，直连部署）**：用真实 `desktop-awf-client` 驱动直连生产，
> 7/7 全过 —— 注册/`/api/auth/methods` 探测 → health+me 连接 → `/api/dsl/capabilities` 能力协商（dsl_version
> workflow-wise/v1、sub_workflow feature）→ 通道① sync 预检/推送/拉取 → 通道③ 远程运行完成（script echo 输出校验）→
> 通道② publish 冻结 → 通道⑤ 遥测摘要（client=desktop 白名单）。双包 awf 单测与 `check:desktop-variants` 复跑全绿。
> 期间发现并修复一处**部署侧**问题：Docker 时代 bind mount 以 root 创建的 `data/runner/` 残留，直连部署的 ubuntu
> 服务无法建 run 工作目录（`chown -R ubuntu:ubuntu ~/awf/data` 解决，非代码缺陷；新建部署注意 data 目录属主）。
> 生产联调方法：`awf-e2e.spec.ts` 有环回守卫（设计如此），生产验证需自写驱动（显式指向生产域名，一次性，勿入库）。

## 整合状态检查（2026-09-17，实测结论：**未完全整合**）〔历史存档〕

按 `docs/DSH_CLIENT_PLAN.md` §1 五通道逐项核验：

| 通道 | 状态 | 证据 |
|------|------|------|
| ① Sync 编辑/备份 | 🟡 **代码就绪，未落地** | 双端代码+测试齐备（beta 18 用例、真实平台 e2e 4/4、AWF 侧 15 用例）；但客户端接线全部位于**未提交的功能分支文件**（契约/controller/route/workflow.ts/面板/编辑器/文案） |
| ② Publish 服务化 | 🔴 未做 | 客户端服务化向导（publish→ApiService→Key）在 awf-0bx |
| ③ Hosted-run 平台执行 | 🔴 未做 | 远程运行 UI/gate 双端在 awf-0bx；平台侧 runs/异步网关已就绪 |
| ④ 桌面反向网关 :8787 | 🟢 独立存在 | dsh-plugin-desktop 既有能力，与平台网关互不依赖 |
| ⑤ Telemetry | ⚪ 远期 | awf-a3c |
| 能力协商 | 🟡 机制就绪，UX 未做 | 平台 `/api/dsl/capabilities`+requires 校验、引擎 capability_missing 门禁均上线；designer 阻断 UX 未做（awf-66p） |

**判定「未完全整合」的两个硬缺口：**

1. **落地缺口（最优先）**：stable 包（`dsh-plugin-desktop/`）**零 awf 代码**（controller 中 0 处引用）——
   仓库规则要求 beta 先行后同步 stable 并通过 `check:desktop-variants`；且 beta 接线所在的
   workflow 功能文件整体未提交（含用户在途改动）。**在功能分支落地 + 变体同步完成之前，
   任何正式构建都不含 AWF 客户端。**
2. **通道缺口**：②服务化向导、③远程运行互通未交付（awf-0bx 整体 open）。

### 整合收尾计划（gap-closure，按序执行）

1. **落地功能分支（需分支作者执行）**：提交工作区中 workflow 功能文件（含 awf 接线：
   契约/route/controller/workflow.ts/WorkflowSettingsPanel/WorkflowEditor/locales/client-api/
   tests/awf-controller.spec.ts）。提交前跑 beta 侧 `corepack yarn workspace dsh-plugin-desktop-beta check`。
2. **beta→stable 变体同步**：将 awf 连接器五件套（settings/client/bridge + controller/route 接线 +
   面板/编辑器/文案）同步 `dsh-plugin-desktop/`，遵守两包声明的变体差异；`corepack yarn check:desktop-variants`
   + 双包 check 全绿后提交（与上游 submodule pin 更新分开提交）。
3. **awf-0bx 交付（通道②③）**：执行位置切换（本地/平台）+ gate 双端 resolve + 服务化向导 +
   golden 双跑一致性用例（基础 5 类型 YAML 双端输出语义一致）。
4. **awf-66p 收尾**：designer 对平台扩展类型标「仅平台可运行」并阻断运行；模板能力标签。
5. **awf-a3c（远期，不阻塞整合判定）**：webhook 触发、telemetry（默认关）、desktop-as-executor PoC。
6. 每步验收统一：受影响包 vitest + typecheck 全绿；联调用 AWF 侧 `scripts/smoke.sh`（23 项基线）+
   `AWF_E2E_BASE_URL=… vitest run tests/awf-e2e.spec.ts`（真实平台 4 项）。

> 整合「完成」的判据：stable 包构建产物包含 AWF 客户端且双包门禁绿 + 通道①②③各有端到端用例 +
> 能力协商 UX 生效。届时在本节标记 ✅。

---

> **进度（2026-09-17）：**
> - ✅ C-P1：核心模块（`desktop-awf-settings/client` + 10 用例）与 **controller/UI 接线均完成**——
>   bridge（已提交）+ 契约/route/controller/workflow.ts/设置面板/双语文案（随工作区未提交的 workflow 功能文件走），
>   controller 层 8 用例全绿；「同步到 AWF」位于工作流设置面板（AWF 平台连接区：baseUrl/令牌 env/指纹/测试连接/同步表单+回执）。
>   服务化向导（publish→ApiService→Key）并入 awf-0bx 交付。
> - ✅ C-P3 引擎核心：`metadata.requires` 门禁（capability_missing）+ `engineCapabilities()` + MCP `workflow_capabilities`
>   （46 用例全绿）；designer 阻断 UX 与模板标签待做
> - ✅ 三轮上线 loop：①远程审批语义对齐（auto_approve 默认 false）②gate 路径段编码/凭据暴露面审计
>   ③真实平台 e2e（`tests/awf-e2e.spec.ts`，AWF_E2E_BASE_URL 环环回守卫，实测 4/4）
> - ⚠ 注意：controller/契约/route/面板/locales 等宿主接线文件本身是**未提交的功能分支文件**，
>   awf 接线改动保留在工作区随该分支一同提交；`desktop-awf-bridge.ts` 独立已提交（仅依赖已入库模块）。
>
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

## 5. C-P5 反向隧道客户端 + 桌面 UI（awf-45y，Phase 3b）

### 新增文件（beta 先行，两侧同名镜像）

| 文件 | 职责 |
|------|------|
| `awf-runner/src/tunnel.ts` | 反向隧道客户端：`createTunnelClient()`（WebSocket 连接到 `wss://host/api/tunnel/ws`，executor token 鉴权、重连踢旧 4001、in-flight 信号量 16、ping 30s/读 90s、SSE chunk 透传、帧协议 request/response/error）；本地 OpenAI 兼容 HTTP 服务器（默认 :8787）转发平台请求经隧道回传响应 |
| `awf-runner/tests/tunnel.spec.ts` | mock WS 服务器验证：连接/重连/请求转发/SSE chunk/超时/满载 |

### 改动文件

- `awf-runner/src/cli.ts`：新增 `tunnel` 命令（`awf-node tunnel --platform <baseUrl> --port 8787`）。
- `awf-runner/src/index.ts`：导出 tunnel 模块。
- `awf-runner/package.json`：新增 `ws` 依赖 + `@types/ws`。
- `dsh-plugin-desktop-beta/src/desktop-awf-bridge.ts`：AwfBridge 接口新增 `getTunnelStatus()`、`setTunnelSettings(enabled, localPort)`；实现内部管理 `createTunnelClient` 生命周期，设置持久化 `tunnelEnabled`、`tunnelLocalPort`。
- `dsh-plugin-desktop-beta/src/desktop-workflow-contract.ts`：新增 op `awfGetTunnelStatus`、`awfSetTunnelSettings`、payload `awfTunnelSettings{ tunnelEnabled?, localPort? }`。
- `dsh-plugin-desktop-beta/src/desktop-workflow-controller.ts`：处理 `awfGetTunnelStatus`、`awfSetTunnelSettings`。
- `dsh-plugin-desktop-beta/src/desktop-workflow-route.ts`：注入 `awfBridge` 到 extras。
- `dsh-plugin-desktop-beta/src/client/desktop-workflow-api.ts`：新增 `AwfTunnelStatusView` 接口、API 方法 `getAwfTunnelStatus()`、`setAwfTunnelSettings(tunnelEnabled, localPort)`。
- `dsh-plugin-desktop-beta/src/client/WorkflowSettingsPanel.tsx`：AWF 平台连接区新增「反向隧道」开关、本地端口、状态显示（已连接/未连接、executor ID、启动时间、错误信息）。
- `dsh-plugin-desktop-beta/src/client/locales-workflow.ts`：新增文案键 `awfTunnel`、`awfTunnelHint`、`awfTunnelConnected`、`awfTunnelDisconnected`、`since`（中英）。

### 验收（awf-45y）

- `corepack yarn check`（beta）+ `check:desktop-variants` 后同步 stable，双包绿。
- 开启隧道后平台 `/s/{slug}/v1/chat/completions` 经隧道转发至本地引擎执行，响应 SSE 透传；
  关闭隧道后回落平台执行；多 executor 并发、重连、断网恢复均正确。
- 设置面板隧道状态实时更新：Connected/Disconnected、executor ID、启动时间、错误信息。

## 6. 流程门禁（每期相同）

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
awf-45y (C-P5 反向隧道) 依赖 C-P2、S-P5（平台侧 Phase 3a 已交付）
```

---

## 7. 后续：Collab Loop（2026-09-26）

跨会话协作状态机在 **Desktop Host**；AWF 仅托管纯净工作流的 `remoteRun`。  
完整计划见 **[collab-loop-plan.md](./collab-loop-plan.md)**；平台侧契约见 AWF 仓 `docs/COLLAB_BRIDGE.md`。
