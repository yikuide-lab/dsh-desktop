import { describe, expect, it } from 'vitest'
import { platformOnlySteps } from '../src/client/desktop-workflow-api.ts'

describe('platform-only step gating (awf-66p)', () => {
  it('基础 5 类型可本地运行', () => {
    expect(platformOnlySteps({
      steps: [
        { type: 'script' },
        { type: 'task' },
        { type: 'llm' },
        { type: 'approval' },
        { type: 'sub_workflow' },
      ],
    })).toEqual([])
  })

  it('平台扩展类型被识别（bloom/mcp/entity）', () => {
    expect(platformOnlySteps({
      steps: [{ type: 'llm' }, { type: 'bloom' }, { type: 'mcp' }, { type: 'entity' }],
    })).toEqual(['bloom', 'mcp', 'entity'])
  })

  it('重复类型去重', () => {
    expect(platformOnlySteps({ steps: [{ type: 'bloom' }, { type: 'bloom' }] })).toEqual(['bloom'])
  })

  it('空/缺 steps → 可运行', () => {
    expect(platformOnlySteps({ steps: [] })).toEqual([])
    expect(platformOnlySteps(undefined)).toEqual([])
  })
})
