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

/**
 * Resolve a unified-seat workflow row (keyed by name) to its arm candidate.
 * Unlike {@link buildRecommendCandidates} this applies no multi-LLM filter —
 * the seat lists every workflow source, and each row must arm. Priority:
 * workspace binding, then saved workflow, then template; a platform-only name
 * falls back to a minimal saved candidate (the send path reports it honestly).
 */
export function buildArmCandidate(input: {
  bindingName: string | null
  workflows: readonly WorkflowView[]
  templates: readonly WorkflowTemplateView[]
  workflowName: string
}): WorkflowRecommendCandidate {
  const saved = input.workflows.find(entry => entry.name === input.workflowName)
  if (input.bindingName === input.workflowName && input.bindingName !== null) {
    return {
      id: `enabled:${input.workflowName}`,
      workflowName: input.workflowName,
      title: saved?.title || input.workflowName,
      source: 'enabled',
      needsProblem: saved
        ? needsProblemParam(saved)
        : input.workflowName === 'multi-llm-problem-review',
    }
  }
  if (saved) {
    return {
      id: `saved:${saved.name}`,
      workflowName: saved.name,
      title: saved.title || saved.name,
      source: 'saved',
      needsProblem: needsProblemParam(saved),
    }
  }
  const template = input.templates.find(entry => entry.name === input.workflowName)
  if (template) {
    return {
      id: `template:${template.id}`,
      workflowName: template.name,
      title: template.name,
      source: 'template',
      needsProblem: template.id === 'multi-llm-coder'
        || template.yaml.includes('$PROBLEM')
        || template.yaml.includes('$PROMPT'),
      templateYaml: template.yaml,
    }
  }
  return {
    id: `saved:${input.workflowName}`,
    workflowName: input.workflowName,
    title: input.workflowName,
    source: 'saved',
    needsProblem: false,
  }
}
