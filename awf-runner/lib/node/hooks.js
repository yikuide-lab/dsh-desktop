/**
 * Headless workflow executor hooks backed by a plain OpenAI-compatible
 * chat-completions endpoint.
 *
 * Configuration comes from the environment:
 *   AWF_NODE_LLM_BASE_URL  e.g. https://api.openai.com/v1 (or any compatible)
 *   AWF_NODE_LLM_API_KEY   Bearer key (optional for local endpoints)
 *   AWF_NODE_LLM_MODEL     default model for steps that don't pin one
 *
 * Semantics: `llm` steps map to a single system+user completion (same prompts
 * as the desktop Host executor). `task` steps collapse the desktop agent
 * session (create + followup + whenIdle) into one completion call — there is
 * no tool-using agent loop on a headless node; acceptance criteria, inputs,
 * and requested outputs are carried in the prompt exactly like the desktop
 * path. Without a configured endpoint no hooks are installed and llm/task
 * steps fail honestly with the engine's built-in error.
 */
import { buildRsiReviewPrompt, parseRsiReviewResponse, RSI_REVIEW_MAX_TOKENS, } from 'dsh-plugin-workflow/engine';
import { buildLlmPrompt, buildLlmSystemPrompt, buildTaskPrompt, resolveLlmMaxTokens, } from './prompt.js';
export const NODE_LLM_BASE_URL_ENV = 'AWF_NODE_LLM_BASE_URL';
export const NODE_LLM_API_KEY_ENV = 'AWF_NODE_LLM_API_KEY';
export const NODE_LLM_MODEL_ENV = 'AWF_NODE_LLM_MODEL';
/** Read the LLM endpoint config from env; null when not configured. */
export function nodeLlmConfigFromEnv(env = process.env) {
    const baseUrl = env[NODE_LLM_BASE_URL_ENV]?.trim();
    const model = env[NODE_LLM_MODEL_ENV]?.trim();
    if (!baseUrl || !model)
        return null;
    let parsed;
    try {
        parsed = new URL(baseUrl);
    }
    catch {
        return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
        return null;
    return {
        baseUrl: baseUrl.replace(/\/+$/, ''),
        apiKey: env[NODE_LLM_API_KEY_ENV]?.trim() ?? '',
        model,
    };
}
/** One non-streaming chat completion; resolves to the assistant text. */
export async function chatCompletion(config, request, signal, fetchImpl = fetch) {
    const model = request.model?.trim() || config.model;
    const messages = [];
    if (request.system)
        messages.push({ role: 'system', content: request.system });
    messages.push({ role: 'user', content: request.user });
    let response;
    try {
        response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
            },
            body: JSON.stringify({ model, messages, max_tokens: request.maxTokens, stream: false }),
            signal,
        });
    }
    catch (error) {
        if (signal.aborted)
            throw new Error('aborted');
        throw new Error(`LLM endpoint unreachable (${config.baseUrl}): ${error instanceof Error ? error.message : String(error)}`);
    }
    const text = await response.text();
    let payload = {};
    try {
        payload = text ? JSON.parse(text) : {};
    }
    catch {
        payload = {};
    }
    if (!response.ok) {
        const detail = typeof payload.error?.message === 'string'
            ? payload.error.message
            : text.slice(0, 500) || `HTTP ${response.status}`;
        throw new Error(`LLM completion failed (HTTP ${response.status}): ${detail}`);
    }
    const content = payload.choices?.[0]?.message?.content;
    const out = typeof content === 'string' ? content.trim() : '';
    if (!out)
        throw new Error('workflow executor: empty LLM response');
    return { text: out, model };
}
async function guardOutcome(run, build) {
    try {
        const { text, model } = await run();
        return build(text, model);
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}
/** Desktop steps pin `provider/model` routes; on a node only the model part applies. */
function stepModel(stepModelRoute) {
    if (typeof stepModelRoute !== 'string' || !stepModelRoute.trim())
        return undefined;
    const route = stepModelRoute.trim();
    const slash = route.indexOf('/');
    return slash >= 0 ? route.slice(slash + 1) : route;
}
/**
 * Build DesktopExecutorHooks for a headless node. Returns {} when no endpoint
 * is configured so the engine fails llm/task steps with its honest default.
 */
export function createNodeExecutorHooks(config, options = {}) {
    if (!config)
        return {};
    const doFetch = options.fetchImpl ?? fetch;
    return {
        runLlm: (step, context, _cwd, signal) => {
            if (signal.aborted)
                return Promise.resolve({ ok: false, error: 'aborted' });
            if (!step.prompt)
                return Promise.resolve({ ok: false, error: 'LLM step missing prompt' });
            return guardOutcome(() => chatCompletion(config, {
                system: buildLlmSystemPrompt(step),
                user: buildLlmPrompt(step, context),
                maxTokens: resolveLlmMaxTokens(step),
                ...(stepModel(step.model) ? { model: stepModel(step.model) } : {}),
            }, signal, doFetch), (text, model) => ({ ok: true, output: { text, provider: 'openai-compatible', model } }));
        },
        runTask: (step, context, cwd, signal) => {
            if (signal.aborted)
                return Promise.resolve({ ok: false, error: 'aborted' });
            return guardOutcome(() => chatCompletion(config, {
                user: buildTaskPrompt(step, context, cwd),
                maxTokens: resolveLlmMaxTokens(step),
                ...(stepModel(step.model) ? { model: stepModel(step.model) } : {}),
            }, signal, doFetch), (text, model) => ({
                ok: true,
                output: {
                    text,
                    model,
                    ...(step.role ? { role: step.role } : {}),
                },
            }));
        },
        runRsiReview: (request, signal) => {
            const prompt = buildRsiReviewPrompt(request);
            return chatCompletion(config, {
                system: prompt.system,
                user: prompt.user,
                maxTokens: RSI_REVIEW_MAX_TOKENS,
            }, signal ?? new AbortController().signal, doFetch)
                .then(({ text }) => parseRsiReviewResponse(text, request.yaml));
        },
    };
}
//# sourceMappingURL=hooks.js.map