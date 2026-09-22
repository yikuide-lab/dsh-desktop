/**
 * Run-level shared vision helpers for workflow steps.
 * Steps may publish `{ shared: {...} }` or `{ vision_append: "..." }` in results.
 */
/** Extract a mergeable shared patch from a step result. */
export function extractSharedPatch(output) {
    if (!output || typeof output !== 'object')
        return null;
    const record = output;
    if (record.shared && typeof record.shared === 'object' && !Array.isArray(record.shared)) {
        return { ...record.shared };
    }
    if (typeof record.vision_append === 'string' && record.vision_append.trim()) {
        return { vision_append: record.vision_append.trim() };
    }
    // LLM outputs are usually `{ text }`; try to parse a JSON object from fenced/raw text.
    if (typeof record.text === 'string') {
        const parsed = tryParseJsonObject(record.text);
        if (parsed?.shared && typeof parsed.shared === 'object' && !Array.isArray(parsed.shared)) {
            return { ...parsed.shared };
        }
        if (parsed && (parsed.match !== undefined || parsed.plan !== undefined || parsed.rationale !== undefined)) {
            return { router: parsed };
        }
    }
    if (typeof output === 'string') {
        const parsed = tryParseJsonObject(output);
        if (parsed?.shared && typeof parsed.shared === 'object' && !Array.isArray(parsed.shared)) {
            return { ...parsed.shared };
        }
        if (parsed && (parsed.match !== undefined || parsed.plan !== undefined)) {
            return { router: parsed };
        }
    }
    return null;
}
/** Shallow-merge shared patches; concatenate vision_append strings. */
export function mergeSharedVision(current, patch) {
    const next = { ...current, ...patch };
    const prevAppend = typeof current.vision_append === 'string' ? current.vision_append : '';
    const patchAppend = typeof patch.vision_append === 'string' ? patch.vision_append : '';
    if (prevAppend || patchAppend) {
        next.vision_append = [prevAppend, patchAppend].filter(Boolean).join('\n\n');
    }
    return next;
}
function tryParseJsonObject(text) {
    const trimmed = text.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = (fenced?.[1] ?? trimmed).trim();
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start)
        return null;
    try {
        const value = JSON.parse(candidate.slice(start, end + 1));
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return value;
        }
    }
    catch {
        return null;
    }
    return null;
}
//# sourceMappingURL=shared-vision.js.map