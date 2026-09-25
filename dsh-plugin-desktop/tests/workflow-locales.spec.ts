/**
 * Workflow locale dictionaries stay balanced across zh/en/ja/ko.
 */

import { describe, expect, it } from 'vitest'
import { en, zh, ja, ko, type WorkflowLocaleKey } from '../src/client/locales-workflow.ts'

describe('workflow locales', () => {
  it('keeps zh/en/ja/ko key sets identical', () => {
    const zhKeys = Object.keys(zh).sort()
    expect(Object.keys(en).sort()).toEqual(zhKeys)
    expect(Object.keys(ja).sort()).toEqual(zhKeys)
    expect(Object.keys(ko).sort()).toEqual(zhKeys)
    expect(zhKeys.length).toBeGreaterThan(500)
  })

  it('preserves placeholders from English in ja and ko', () => {
    const placeholder = /\{[^}]+\}/g
    for (const key of Object.keys(en) as WorkflowLocaleKey[]) {
      const expected = new Set(en[key].match(placeholder) ?? [])
      if (expected.size === 0) continue
      expect(new Set(ja[key].match(placeholder) ?? []), `ja:${key}`).toEqual(expected)
      expect(new Set(ko[key].match(placeholder) ?? []), `ko:${key}`).toEqual(expected)
    }
  })

  it('translates core chrome labels for ja and ko', () => {
    expect(ja.tab).toBe('ワークフロー')
    expect(ko.tab).toBe('워크플로')
    expect(ja.save).toBe('保存')
    expect(ko.save).toBe('저장')
    expect(ja.seatTabWorkflows).toContain('ワークフロー')
    expect(ko.seatTabWorkflows).toContain('워크플로')
  })
})
