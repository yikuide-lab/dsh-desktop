import { describe, expect, it } from 'vitest'
import type { WorkflowTemplateView, WorkflowView } from '../src/client/desktop-workflow-api.ts'
import {
  buildRecommendCandidates,
  isMultiLlmWorkflow,
} from '../src/client/workflow-recommend-candidates.ts'

function workflow(partial: Partial<WorkflowView> & Pick<WorkflowView, 'name'>): WorkflowView {
  const view: WorkflowView = {
    name: partial.name,
    title: partial.title ?? partial.name,
    steps: partial.steps ?? [],
  }
  if (partial.description !== undefined) view.description = partial.description
  if (partial.apiVersion !== undefined) view.apiVersion = partial.apiVersion
  if (partial.kind !== undefined) view.kind = partial.kind
  return view
}

function template(partial: Partial<WorkflowTemplateView> & Pick<WorkflowTemplateView, 'id' | 'name' | 'yaml'>): WorkflowTemplateView {
  return {
    id: partial.id,
    name: partial.name,
    yaml: partial.yaml,
    description: partial.description ?? '',
    category: partial.category ?? 'analysis',
  }
}

describe('workflow recommend candidates', () => {
  it('orders enabled, then saved multi-llm, then templates; dedupes by workflowName', () => {
    const candidates = buildRecommendCandidates({
      bindingName: 'multi-llm-code-review',
      workflows: [
        workflow({
          name: 'multi-llm-code-review',
          title: 'Code Review',
          steps: [
            { id: 'a', type: 'llm' },
            { id: 'b', type: 'llm' },
          ],
        }),
        workflow({
          name: 'multi-llm-problem-review',
          title: 'Problem Review',
          steps: [{ id: 'x', type: 'llm', prompt: 'Q: $PROBLEM' }],
        }),
      ],
      templates: [
        template({
          id: 'multi-llm-code-review',
          name: 'Multi-LLM Code Review',
          yaml: 'name: multi-llm-code-review',
        }),
        template({
          id: 'multi-llm-problem-review',
          name: 'Multi-LLM Problem Review',
          yaml: 'prompt: $PROBLEM',
        }),
        template({
          id: 'code-review',
          name: 'Code Review',
          yaml: 'name: code-review',
        }),
      ],
    })

    expect(candidates.map((c) => c.id)).toEqual([
      'enabled:multi-llm-code-review',
      'saved:multi-llm-problem-review',
    ])
    expect(candidates[0]?.source).toBe('enabled')
    expect(candidates[1]?.needsProblem).toBe(true)
  })

  it('falls back to template candidates when nothing is saved', () => {
    const candidates = buildRecommendCandidates({
      bindingName: null,
      workflows: [],
      templates: [
        template({
          id: 'multi-llm-code-review',
          name: 'Multi-LLM Code Review',
          yaml: 'name: multi-llm-code-review',
        }),
        template({
          id: 'multi-llm-problem-review',
          name: 'Multi-LLM Problem Review',
          yaml: 'prompt: $PROBLEM',
        }),
      ],
    })

    expect(candidates).toHaveLength(2)
    expect(candidates[0]).toMatchObject({
      source: 'template',
      workflowName: 'multi-llm-code-review',
      needsProblem: false,
    })
    expect(candidates[1]).toMatchObject({
      source: 'template',
      workflowName: 'multi-llm-problem-review',
      needsProblem: true,
      templateYaml: 'prompt: $PROBLEM',
    })
  })

  it('includes multi-llm-coder among template candidates', () => {
    const candidates = buildRecommendCandidates({
      bindingName: null,
      workflows: [],
      templates: [
        template({
          id: 'multi-llm-coder',
          name: 'Multi-LLM Coder',
          yaml: 'prompt: $PROMPT',
        }),
      ],
    })
    expect(candidates).toEqual([
      expect.objectContaining({
        source: 'template',
        workflowName: 'multi-llm-coder',
        needsProblem: true,
      }),
    ])
  })

  it('detects multi-llm workflows by name, PROBLEM, or parallel llm steps', () => {
    expect(isMultiLlmWorkflow(workflow({ name: 'multi-llm-x', steps: [] }))).toBe(true)
    expect(isMultiLlmWorkflow(workflow({
      name: 'custom',
      steps: [{ id: 'a', type: 'llm', prompt: '$PROBLEM' }],
    }))).toBe(true)
    expect(isMultiLlmWorkflow(workflow({
      name: 'custom',
      steps: [
        { id: 'a', type: 'llm' },
        { id: 'b', type: 'llm' },
      ],
    }))).toBe(true)
    expect(isMultiLlmWorkflow(workflow({
      name: 'plain',
      steps: [{ id: 'a', type: 'script', run: 'echo hi' }],
    }))).toBe(false)
  })
})
