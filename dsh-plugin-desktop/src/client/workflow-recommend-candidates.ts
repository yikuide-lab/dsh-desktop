import type { WorkflowTemplateView, WorkflowView } from './desktop-workflow-api.js'
import { needsProblemParam } from './workflow-run-params.js'

/** Builtin multi-LLM template ids surfaced as composer recommendations. */
export const MULTI_LLM_TEMPLATE_IDS = [
  'multi-llm-code-review',
  'multi-llm-problem-review',
  'multi-llm-coder',
] as const

export type WorkflowRecommendSource = 'enabled' | 'saved' | 'template'

export interface WorkflowRecommendCandidate {
  /** Menu id (unique). */
  id: string
  workflowName: string
  title: string
  source: WorkflowRecommendSource
  needsProblem: boolean
  /** Present when the candidate must be materialised via saveWorkflow first. */
  templateYaml?: string
}

/** Detect saved workflows that are multi-LLM aggregations worth recommending. */
export function isMultiLlmWorkflow(workflow: WorkflowView): boolean {
  if (workflow.name.startsWith('multi-llm-')) return true
  if (needsProblemParam(workflow)) return true
  return workflow.steps.filter((step) => step.type === 'llm').length >= 2
}

/**
 * Build ordered recommend candidates: enabled binding, then saved multi-LLM,
 * then builtin templates not already covered (deduped by workflowName).
 */
export function buildRecommendCandidates(input: {
  bindingName: string | null
  workflows: readonly WorkflowView[]
  templates: readonly WorkflowTemplateView[]
}): WorkflowRecommendCandidate[] {
  const seen = new Set<string>()
  const out: WorkflowRecommendCandidate[] = []

  const add = (candidate: WorkflowRecommendCandidate): void => {
    if (seen.has(candidate.workflowName)) return
    seen.add(candidate.workflowName)
    out.push(candidate)
  }

  if (input.bindingName) {
    const bound = input.workflows.find((workflow) => workflow.name === input.bindingName)
    add({
      id: `enabled:${input.bindingName}`,
      workflowName: input.bindingName,
      title: bound?.title || input.bindingName,
      source: 'enabled',
      needsProblem: bound
        ? needsProblemParam(bound)
        : input.bindingName === 'multi-llm-problem-review',
    })
  }

  for (const workflow of input.workflows) {
    if (!isMultiLlmWorkflow(workflow)) continue
    add({
      id: `saved:${workflow.name}`,
      workflowName: workflow.name,
      title: workflow.title || workflow.name,
      source: 'saved',
      needsProblem: needsProblemParam(workflow),
    })
  }

  for (const template of input.templates) {
    if (!(MULTI_LLM_TEMPLATE_IDS as readonly string[]).includes(template.id)) continue
    add({
      id: `template:${template.id}`,
      workflowName: template.id,
      title: template.name,
      source: 'template',
      templateYaml: template.yaml,
      needsProblem: template.id === 'multi-llm-problem-review'
        || template.id === 'multi-llm-coder'
        || template.yaml.includes('$PROBLEM')
        || template.yaml.includes('$PROMPT'),
    })
  }

  return out
}
