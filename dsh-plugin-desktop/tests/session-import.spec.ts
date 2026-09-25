/**
 * Session-import scanners + converters against checked-in fixtures.
 */

import { describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildSeedEvents,
  convertClaudeSession,
  convertCodexSession,
  convertOpencodeSession,
  listExternalSessions,
  searchExternalSessions,
  type SessionImportRoots,
} from '../src/session-import/index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fixtureRoot = join(here, 'fixtures', 'session-import')

const roots: SessionImportRoots = {
  claudeProjects: join(fixtureRoot, 'claude-projects'),
  codexSessions: join(fixtureRoot, 'codex-root'),
  codexArchived: join(fixtureRoot, 'codex-archived-missing'),
  opencodeData: join(fixtureRoot, 'opencode'),
}

describe('session-import fixtures', () => {
  it('converts Claude JSONL into text turns and warns about tools', () => {
    const path = join(fixtureRoot, 'claude-projects', '-tmp-demo', 'sess-claude-1.jsonl')
    const result = convertClaudeSession(path)
    expect(result.cwd).toBe('/tmp/demo')
    expect(result.turns.map(turn => turn.role)).toEqual(['user', 'assistant', 'user'])
    expect(result.turns[0]?.text).toContain('Hello from Claude')
    expect(result.turns[1]?.text).toContain('Hi there')
    expect(result.turns[1]?.text).toContain('[Bash]')
    expect(result.warnings.some(warning => /tool/i.test(warning))).toBe(true)
  })

  it('converts Codex rollout JSONL', () => {
    const path = join(
      fixtureRoot,
      'codex-root',
      '2026',
      '01',
      '02',
      'rollout-2026-01-02T00-00-00-11111111-2222-3333-4444-555555555555.jsonl',
    )
    const result = convertCodexSession(path)
    expect(result.cwd).toBe('/tmp/codex')
    expect(result.title).toContain('Codex fixture')
    expect(result.turns).toHaveLength(2)
    expect(result.turns[0]?.text).toBe('Hello from Codex')
  })

  it('converts OpenCode JSON storage with parts', () => {
    const path = join(fixtureRoot, 'opencode', 'storage', 'session', 'global', 'ses_test001.json')
    const result = convertOpencodeSession(path)
    expect(result.cwd).toBe('/tmp/opencode')
    expect(result.title).toContain('OpenCode fixture')
    expect(result.turns.map(turn => turn.text)).toEqual(['Hello from OpenCode', 'OpenCode reply'])
  })

  it('lists and searches across fixture roots', () => {
    const listed = listExternalSessions(['claude', 'codex', 'opencode'], roots)
    expect(listed.map(item => item.source).sort()).toEqual(['claude', 'codex', 'opencode'])
    const hit = searchExternalSessions({ query: 'OpenCode fixture', roots })
    expect(hit.some(item => item.source === 'opencode')).toBe(true)
    const claudeHit = searchExternalSessions({ query: 'Hello from Claude', roots, content: true })
    expect(claudeHit.some(item => item.source === 'claude')).toBe(true)
  })

  it('builds a contiguous seed with surface append markers', () => {
    const seed = buildSeedEvents([
      { role: 'user', text: 'hi', timeMs: 10 },
      { role: 'assistant', text: 'yo', timeMs: 11 },
    ])
    expect(seed[0]?.type).toBe('turn/start')
    expect(seed.some(event => event.type === 'user/message')).toBe(true)
    expect(seed.some(event => event.type === 'assistant/message')).toBe(true)
    expect(seed.at(-1)?.type).toBe('turn/end')
    const seqs = seed.map(event => event.seq)
    expect(seqs).toEqual([0, 1, 2, 3])
  })
})
