import type { DesktopWorkflowApi } from './desktop-workflow-api.js'

/**
 * Ask the design completion for a small flat YAML document and read it back as
 * key/value pairs.
 *
 * The design completion already returns canonicalized YAML, which doubles as a
 * structured-output channel — so trigger configs, stat readings and metadata can
 * be generated without a second host op (and without touching the request
 * contract the router allowlists).
 */
export async function requestYamlFields(
  api: Pick<DesktopWorkflowApi, 'designWorkflow'>,
  input: { system: string; prompt: string; maxTokens?: number },
): Promise<Record<string, string> | null> {
  const result = await api.designWorkflow({
    prompt: `${input.system}\n\n${input.prompt}`,
    mode: 'create',
    maxTokens: input.maxTokens ?? 768,
  })
  return parseYamlFields(result.yaml)
}

/**
 * Parse a flat top-level `key: value` YAML document (fenced or bare).
 * Indented continuation lines and comments are skipped: callers ask for one
 * scalar per key, so anything nested is out of contract and ignored.
 * @param text - canonicalized YAML from the design completion.
 * @returns the field map, or null when nothing parseable was emitted.
 */
export function parseYamlFields(text: string): Record<string, string> | null {
  const fenced = /```(?:yaml)?\s*([\s\S]*?)```/i.exec(text)
  const body = fenced?.[1] ?? text
  const out: Record<string, string> = {}
  let seen = 0
  for (const line of body.split('\n')) {
    if (line.trim() === '' || /^\s*#/.test(line)) continue
    const matched = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (!matched) continue
    const value = matched[2] ?? ''
    out[matched[1]!] = value.replace(/^['"]|['"]$/g, '').trim()
    seen += 1
  }
  return seen > 0 ? out : null
}
