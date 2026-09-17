import { describe, expect, it } from 'vitest'
import { checkWorkflowDependencies, formatDependencyIssues } from '../src/client/workflow-deps.ts'
import type { WorkflowView } from '../src/client/desktop-workflow-api.ts'

function workflow(partial: Partial<WorkflowView> & Pick<WorkflowView, 'name'>): WorkflowView {
  return {
    name: partial.name,
    title: partial.title ?? partial.name,
    steps: partial.steps ?? [],
  }
}

describe('workflow dependency check', () => {
  it('flags missing prompt when required', () => {
    const report = checkWorkflowDependencies(
      workflow({ name: 'multi-llm-coder', steps: [{ id: 'route', type: 'llm', role: 'router' }] }),
      { providers: [], defaultBias: 'coding', defaultRetries: 2, defaultOnFailure: 'fail' },
      { requirePrompt: true, prompt: '  ' },
    )
    expect(report.ok).toBe(false)
    expect(report.issues.some((issue) => issue.id === 'prompt' && issue.blocking)).toBe(true)
  })

  it('blocks pure LLM workflows when providers are empty', () => {
    const report = checkWorkflowDependencies(
      workflow({
        name: 'multi-llm-coder',
        steps: [
          { id: 'route', type: 'llm', role: 'router' },
          { id: 'implement', type: 'llm', role: 'implement' },
        ],
      }),
      { providers: [], defaultBias: 'coding', defaultRetries: 2, defaultOnFailure: 'fail' },
      { requirePrompt: true, prompt: 'fix bug' },
    )
    expect(report.ok).toBe(false)
    expect(report.issues.some((issue) => issue.id === 'providers-empty' && issue.blocking)).toBe(true)
  })

  it('soft-warns when providers are empty but script steps remain runnable', () => {
    const report = checkWorkflowDependencies(
      workflow({
        name: 'mixed',
        steps: [
          { id: 'echo', type: 'script', run: 'echo hi' },
          { id: 'llm', type: 'llm', role: 'router' },
        ],
      }),
      { providers: [], defaultBias: 'coding', defaultRetries: 2, defaultOnFailure: 'fail' },
    )
    expect(report.ok).toBe(true)
    expect(report.issues.some((issue) => issue.id === 'providers-empty' && !issue.blocking)).toBe(true)
  })

  it('flags uncovered roles when providers exist', () => {
    const report = checkWorkflowDependencies(
      workflow({
        name: 'x',
        steps: [{ id: 'a', type: 'llm', role: 'security-reviewer' }],
      }),
      {
        defaultBias: 'coding',
        defaultRetries: 2,
        defaultOnFailure: 'fail',
        providers: [{ id: 'ds', model: 'deepseek/chat', bias: ['coding'] }],
      },
    )
    expect(report.issues.some((issue) => issue.id === 'role:security-reviewer')).toBe(true)
    expect(formatDependencyIssues(report.issues)).toContain('security-reviewer')
  })

  it('passes when bias covers role', () => {
    const report = checkWorkflowDependencies(
      workflow({
        name: 'x',
        steps: [{ id: 'a', type: 'llm', role: 'implement' }],
      }),
      {
        defaultBias: 'coding',
        defaultRetries: 2,
        defaultOnFailure: 'fail',
        providers: [{ id: 'ds', model: 'deepseek/chat', bias: ['implement', 'coding'] }],
      },
      { requirePrompt: true, prompt: 'ship it' },
    )
    expect(report.issues).toEqual([])
    expect(report.ok).toBe(true)
  })
})
