# Agent Note: Workflow OpenAI-compatible API (phase 1)

Status: implemented

English | [中文](2026-09-14-workflow-openai-compatible-api.zh.md)

## Problem

Third-party OpenAI SDKs cannot drive Desktop workflows without either scraping the UI session or attaching to the loopback WebServer used for the product chrome. Those surfaces are not intended for LAN clients and must not be relaxed for Bearer auth or non-loopback binds.

## Decision

Ship an **optional**, **default-off** OpenAI-compatible listener owned by the Desktop Host workflow plugin:

- Coverage is **workflows only**: `model` equals a saved workflow `name`. No bare model chat.
- Routes: `GET /v1/models`, `POST /v1/chat/completions` (JSON and SSE).
- The listener is a **separate** HTTP(S) server from the UI `127.0.0.1` WebServer. Do not mount it on the chrome carrier.
- **Non-loopback binds require HTTPS + Bearer.** Loopback may use HTTP. Plain LAN HTTP is refused; missing TLS material fails startup instead of degrading.
- Settings and key rotation go through Host ops (`getOpenAiApiStatus` / `setOpenAiApiSettings` / `rotateOpenAiApiKey`). The renderer never reads the key file; a newly issued key is returned once in the op response.

## Consequences

- Enabling the API auto-generates a high-entropy Bearer key when none exists.
- Audit lines (runId, workflow, remote IP) go to the Host logger; responses omit internal stacks.
- Phase 1 excludes embeddings, images, tools parity, Fabric, and MCP-over-HTTP.
