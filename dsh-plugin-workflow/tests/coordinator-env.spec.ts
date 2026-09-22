import { describe, expect, it } from 'vitest'
import { buildStepEnv, pickParam } from '../src/engine/coordinator.ts'

describe('pickParam', () => {
  it('returns the first string-valued key in priority order', () => {
    expect(pickParam({ PROBLEM: 'a', problem: 'b' }, ['PROBLEM', 'problem'])).toBe('a')
    expect(pickParam({ problem: 'b' }, ['PROBLEM', 'problem'])).toBe('b')
  })

  it('skips non-string values', () => {
    expect(pickParam({ PROMPT: 42, prompt: 'ok' }, ['PROMPT', 'prompt'])).toBe('ok')
  })

  it('returns undefined when no key matches or params missing', () => {
    expect(pickParam({ other: 'x' }, ['PROMPT', 'prompt'])).toBeUndefined()
    expect(pickParam(undefined, ['PROMPT'])).toBeUndefined()
  })
})

describe('buildStepEnv', () => {
  it('maps workspaceRoot and sessionId', () => {
    expect(buildStepEnv({ workspaceRoot: '/ws', sessionId: 's1' })).toEqual({
      WORKSPACE_ROOT: '/ws',
      SESSION_ID: 's1',
    })
  })

  it('maps PROMPT from PROMPT then prompt', () => {
    expect(buildStepEnv({ PROMPT: 'hi' }).PROMPT).toBe('hi')
    expect(buildStepEnv({ prompt: 'hi' }).PROMPT).toBe('hi')
  })

  it('maps PROBLEM from PROBLEM/problem/QUESTION/question then falls back to PROMPT/prompt', () => {
    expect(buildStepEnv({ PROBLEM: 'p' }).PROBLEM).toBe('p')
    expect(buildStepEnv({ problem: 'p' }).PROBLEM).toBe('p')
    expect(buildStepEnv({ QUESTION: 'q' }).PROBLEM).toBe('q')
    expect(buildStepEnv({ question: 'q' }).PROBLEM).toBe('q')
    expect(buildStepEnv({ PROMPT: 'pr' }).PROBLEM).toBe('pr')
    expect(buildStepEnv({ prompt: 'pr' }).PROBLEM).toBe('pr')
  })

  it('prefers PROBLEM over PROMPT for PROBLEM env', () => {
    const env = buildStepEnv({ PROBLEM: 'problem-text', PROMPT: 'prompt-text' })
    expect(env.PROBLEM).toBe('problem-text')
    expect(env.PROMPT).toBe('prompt-text')
  })

  it('returns empty object for empty params', () => {
    expect(buildStepEnv(undefined)).toEqual({})
    expect(buildStepEnv({})).toEqual({})
  })
})
