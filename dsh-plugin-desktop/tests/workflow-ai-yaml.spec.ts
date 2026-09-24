import { describe, expect, it } from 'vitest'
import { parseYamlFields } from '../src/client/workflow-ai-yaml.ts'

describe('parseYamlFields', () => {
  it('reads a fenced flat document', () => {
    expect(parseYamlFields('```yaml\ntype: cron\nschedule: 0 9 * * *\n```'))
      .toEqual({ type: 'cron', schedule: '0 9 * * *' })
  })

  it('reads a bare document and strips quotes', () => {
    expect(parseYamlFields('summary: \'一切正常\'\nrisks: "无"'))
      .toEqual({ summary: '一切正常', risks: '无' })
  })

  it('skips comments, blanks and nested lines', () => {
    const parsed = parseYamlFields([
      '# comment',
      '',
      'type: event',
      'params:',
      '  nested: ignored',
      'filter: data.status=ok',
    ].join('\n'))
    expect(parsed).toEqual({ type: 'event', params: '', filter: 'data.status=ok' })
  })

  it('returns null when nothing parseable was emitted', () => {
    expect(parseYamlFields('')).toBeNull()
    expect(parseYamlFields('just prose with no keys')).toBeNull()
    expect(parseYamlFields('```yaml\n# only a comment\n```')).toBeNull()
  })
})
