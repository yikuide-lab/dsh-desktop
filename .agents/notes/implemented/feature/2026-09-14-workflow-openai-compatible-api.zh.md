# Agent Note: 工作流 OpenAI 兼容 API（第一期）

Status: implemented

[English](2026-09-14-workflow-openai-compatible-api.md) | 中文

## 问题

第三方 OpenAI SDK 无法在不刮取 UI 会话、或不挂到产品 chrome 使用的 loopback WebServer 的情况下驱动 Desktop 工作流。这些表面不适合局域网客户端，也不得为 Bearer 鉴权或非本机绑定而放宽。

## 决策

由 Desktop Host 工作流插件提供**可选、默认关闭**的 OpenAI 兼容监听器：

- **仅工作流**：`model` = 已保存工作流的 `name`；不提供裸模型 chat。
- 路由：`GET /v1/models`、`POST /v1/chat/completions`（JSON 与 SSE）。
- 监听器是**独立于** UI `127.0.0.1` WebServer 的 HTTP(S) 服务；不得挂到 chrome 载体上。
- **非 loopback 绑定必须 HTTPS + Bearer**。loopback 可用 HTTP。明文局域网 HTTP 拒绝；证书不可用则启动失败，不降级。
- 设置与密钥轮换经 Host ops（`getOpenAiApiStatus` / `setOpenAiApiSettings` / `rotateOpenAiApiKey`）。渲染进程不直读密钥文件；新密钥仅在 op 响应中一次性返回。

## 后果

- 启用且尚无密钥时自动生成高熵 Bearer。
- 审计（runId、工作流、远端 IP）写 Host logger；响应不泄露内部 stack。
- 第一期不做 embeddings / images / tools parity、Fabric、MCP-over-HTTP。
