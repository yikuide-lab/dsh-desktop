/** Built-in problem-loop template shipped with Desktop beta collab UI. */

import { readFileSync } from 'node:fs'

const TEMPLATE_PATH = new URL('./templates/problem-loop.yaml', import.meta.url)

/** Inline fallback when the YAML file is not present next to the compiled module. */
const PROBLEM_LOOP_YAML_FALLBACK = `apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: problem-loop
  title: Problem Collab Loop
  description: Multi-peer loop for analyzing and solving a stated problem (Desktop collab only)
  requires: [collab]
spec:
  steps:
    - id: frame
      type: llm
      role: router
      prompt: |
        Frame the problem $PROBLEM into goals, constraints, and success criteria.
        Output a short markdown plan.
    - id: researcher
      type: collab_peer
      deps: [frame]
      peer:
        kind: agent
        open: true
        slot: researcher
        role: researcher
        grant: [vision:read, vision:write, bus:send]
    - id: implement
      type: task
      deps: [researcher]
      role: coding
      inputs:
        problem: "$PROBLEM"
      acceptance:
        - Delivers a concrete answer or artifact
    - id: reviewer
      type: collab_peer
      deps: [implement]
      peer:
        kind: agent
        open: true
        slot: reviewer
        role: reviewer
    - id: approve
      type: approval
      deps: [reviewer]
      question: Accept the proposed solution?
      options: [approved, rejected, needs-changes]
      pass: [approved]
    - id: summarize
      type: llm
      deps: [approve]
      role: summary-editor
      prompt: |
        Summarize the problem, approach, and outcome as markdown for the Collab vision board.
`

let cachedYaml: string | undefined

function loadProblemLoopYaml(): string {
  if (cachedYaml === undefined) {
    try {
      cachedYaml = readFileSync(TEMPLATE_PATH, 'utf8')
    } catch {
      cachedYaml = PROBLEM_LOOP_YAML_FALLBACK
    }
  }
  return cachedYaml
}

export interface ProblemLoopTemplateView {
  id: string
  name: string
  description: string
  category: 'analysis'
  yaml: string
  builtin: true
}

/** Catalog entry merged into listTemplates from the beta Host controller. */
export function problemLoopBuiltinTemplate(): ProblemLoopTemplateView {
  return {
    id: 'problem-loop',
    name: 'Problem Collab Loop',
    description: 'Open peer slots for research/review around a stated problem',
    category: 'analysis',
    yaml: loadProblemLoopYaml(),
    builtin: true,
  }
}
