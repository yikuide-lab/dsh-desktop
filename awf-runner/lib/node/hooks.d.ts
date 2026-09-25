/**
 * Headless workflow executor hooks backed by a plain OpenAI-compatible
 * chat-completions endpoint.
 *
 * Configuration comes from the environment:
 *   AWF_NODE_LLM_BASE_URL  e.g. https://api.openai.com/v1 (or any compatible)
 *   AWF_NODE_LLM_API_KEY   Bearer key (optional for local endpoints)
 *   AWF_NODE_LLM_MODEL     default model for steps that don't pin one
 *   AWF_NODE_LLM_API       wire protocol: openai-completions (default),
 *                          openai-responses, or anthropic-messages
 *
 * Semantics: `llm` steps map to a single system+user completion (same prompts
 * as the desktop Host executor). `task` steps collapse the desktop agent
 * session (create + followup + whenIdle) into one completion call — there is
 * no tool-using agent loop on a headless node; acceptance criteria, inputs,
 * and requested outputs are carried in the prompt exactly like the desktop
 * path. Without a configured endpoint no hooks are installed and llm/task
 * steps fail honestly with the engine's built-in error.
 */
import { type DesktopExecutorHooks } from 'dsh-plugin-workflow/engine';
import type { AwfFetch } from '../awf/client.js';
/** Wire protocols a headless runner may speak; names match llm-pi-ai's table. */
export type NodeLlmApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages';
export interface NodeLlmConfig {
    readonly baseUrl: string;
    readonly apiKey: string;
    readonly model: string;
    readonly api: NodeLlmApi;
}
export declare const NODE_LLM_BASE_URL_ENV = "AWF_NODE_LLM_BASE_URL";
export declare const NODE_LLM_API_KEY_ENV = "AWF_NODE_LLM_API_KEY";
export declare const NODE_LLM_MODEL_ENV = "AWF_NODE_LLM_MODEL";
export declare const NODE_LLM_API_ENV = "AWF_NODE_LLM_API";
/** Read the LLM endpoint config from env; null when not configured. */
export declare function nodeLlmConfigFromEnv(env?: Record<string, string | undefined>): NodeLlmConfig | null;
/** Shared non-streaming completion request shape across wire protocols. */
export interface NodeCompletionRequest {
    system?: string;
    user: string;
    maxTokens: number;
    model?: string;
}
/** One non-streaming OpenAI chat-completions call; resolves to the assistant text. */
export declare function chatCompletion(config: NodeLlmConfig, request: NodeCompletionRequest, signal: AbortSignal, fetchImpl?: AwfFetch): Promise<{
    text: string;
    model: string;
}>;
/** One non-streaming OpenAI Responses call; resolves to the assistant text. */
export declare function responsesCompletion(config: NodeLlmConfig, request: NodeCompletionRequest, signal: AbortSignal, fetchImpl?: AwfFetch): Promise<{
    text: string;
    model: string;
}>;
/** One non-streaming Anthropic Messages call; resolves to the assistant text. */
export declare function anthropicCompletion(config: NodeLlmConfig, request: NodeCompletionRequest, signal: AbortSignal, fetchImpl?: AwfFetch): Promise<{
    text: string;
    model: string;
}>;
/** Dispatch one completion over the configured wire protocol. */
export declare function llmCompletion(config: NodeLlmConfig, request: NodeCompletionRequest, signal: AbortSignal, fetchImpl?: AwfFetch): Promise<{
    text: string;
    model: string;
}>;
/**
 * Build DesktopExecutorHooks for a headless node. Returns {} when no endpoint
 * is configured so the engine fails llm/task steps with its honest default.
 */
export declare function createNodeExecutorHooks(config: NodeLlmConfig | null, options?: {
    fetchImpl?: AwfFetch;
}): DesktopExecutorHooks;
//# sourceMappingURL=hooks.d.ts.map