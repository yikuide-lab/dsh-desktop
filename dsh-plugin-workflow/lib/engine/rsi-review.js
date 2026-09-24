/**
 * RSI review contract: one review + improvement pass over a workflow YAML.
 * Shared by the pure-Node engine (storing verdicts), the Desktop Host executor
 * (streaming LLM), and the headless awf-node runner (chat completions).
 */
/** Completion budget for one review + improvement response (the improved YAML rides along). */
export const RSI_REVIEW_MAX_TOKENS = 8192;
/** Build the system + user prompt for one RSI review pass. */
export function buildRsiReviewPrompt(request) {
    const system = [
        'You are the reviewer in a workflow self-iteration (RSI) loop.',
        'Review the workflow YAML against the improvement criteria, then produce an improved version.',
        'Respond with a single JSON object and nothing else:',
        '{"score": <0-100 number>, "feedback": "<review comments and what you changed>", "improvedYaml": "<full improved workflow YAML>"}',
    ].join('\n');
    const sections = [
        `## Problem\n\n${request.title} (${request.domain})`,
        `## Iteration\n\n${request.iterationNumber}`,
    ];
    if (request.improvementCriteria.trim()) {
        sections.push(`## Improvement criteria\n\n${request.improvementCriteria}`);
    }
    if (request.priorFeedback?.trim()) {
        sections.push(`## Previous review feedback\n\n${request.priorFeedback}`);
    }
    sections.push(`## Workflow YAML under review\n\n\`\`\`yaml\n${request.yaml}\n\`\`\``);
    return { system, user: sections.join('\n\n') };
}
/** Extract the JSON verdict from a model response, tolerating prose and code fences. */
function extractJsonObject(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}'))
        return trimmed;
    const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(trimmed);
    if (fenced?.[1]?.trim().startsWith('{'))
        return fenced[1].trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start)
        return trimmed.slice(start, end + 1);
    return trimmed;
}
/**
 * Parse a reviewer response into an RsiReviewResult.
 * @param text - Raw model output (bare JSON, fenced JSON, or JSON inside prose).
 * @param fallbackYaml - YAML to keep when the reviewer returns no improvement.
 * @returns The clamped, normalized verdict.
 */
export function parseRsiReviewResponse(text, fallbackYaml) {
    let payload;
    try {
        payload = JSON.parse(extractJsonObject(text));
    }
    catch {
        throw new Error('rsi review: response is not a JSON verdict');
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        throw new Error('rsi review: response is not a JSON verdict');
    }
    const record = payload;
    const rawScore = typeof record.score === 'number' ? record.score : Number(record.score);
    const score = Number.isFinite(rawScore) ? Math.min(100, Math.max(0, rawScore)) : 0;
    const feedback = typeof record.feedback === 'string' && record.feedback.trim()
        ? record.feedback.trim()
        : '(no review feedback)';
    const improvedYaml = typeof record.improvedYaml === 'string' && record.improvedYaml.trim()
        ? record.improvedYaml
        : fallbackYaml;
    return { score, feedback, improvedYaml };
}
//# sourceMappingURL=rsi-review.js.map