/** awf-a3c C-P4 反向网关治理：默认只绑回环；非回环属显式配置。 */

import { describe, expect, it } from 'vitest'
import {
  WORKFLOW_OPENAI_API_DEFAULT_HOST,
  defaultWorkflowOpenAiApiSettings,
  isLoopbackHost,
  normalizeWorkflowOpenAiApiSettings,
} from '../src/desktop-workflow-openai-settings.ts'

describe('openai gateway bind default (loopback-first)', () => {
  it('默认 bindHost 是 127.0.0.1', () => {
    expect(WORKFLOW_OPENAI_API_DEFAULT_HOST).toBe('127.0.0.1')
    expect(defaultWorkflowOpenAiApiSettings().bindHost).toBe('127.0.0.1')
  })

  it('显式保存的旧非回环值不被静默改写（显式值优先）', () => {
    const normalized = normalizeWorkflowOpenAiApiSettings({
      ...defaultWorkflowOpenAiApiSettings(),
      bindHost: '0.0.0.0',
    })
    expect(normalized.bindHost).toBe('0.0.0.0')
    expect(isLoopbackHost(normalized.bindHost)).toBe(false)
    // 缺省字段回落到新的安全默认
    expect(normalizeWorkflowOpenAiApiSettings({}).bindHost).toBe('127.0.0.1')
  })
})
