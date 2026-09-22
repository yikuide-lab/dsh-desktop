/**
 * Prompt construction for headless workflow steps.
 *
 * Mirrors the desktop Host executor (desktop-workflow-executor.ts) so llm/task
 * steps see the same substitution, upstream-output, and acceptance/outputs
 * sections whether they run in the Electron Host or on an awf-node runner.
 */

import type { ExecutionContext, Step } from 'dsh-plugin-workflow/engine'

export function substituteParams(text: string, context: ExecutionContext): string {
  const params = context.params ?? {}
  return text.replace(/\$([A-Z][A-Z0-9_]*)/g, (match, key: string) => {
    const fromEnv = context.env?.[key]
    if (typeof fromEnv === 'string') return fromEnv
    const fromParams = params[key] ?? params[key.toLowerCase()]
    if (typeof fromParams === 'string' || typeof fromParams === 'number') return String(fromParams)
    return match
  })
}

export function formatStepOutput(output: unknown): string {
  if (typeof output === 'string') return output
  if (output && typeof output === 'object') {
    const record = output as Record<string, unknown>
    if (typeof record.text === 'string' && record.text.trim()) return record.text
    if (typeof record.stdout === 'string' && record.stdout.trim()) return record.stdout
    try {
      return JSON.stringify(output, null, 2)
    } catch {
      return String(output)
    }
  }
  return String(output)
}

export function appendContextSections(prompt: string, context: ExecutionContext): string {
  const sections: string[] = []
  if (context.shared && Object.keys(context.shared).length > 0) {
    sections.push(`## Shared vision\n\n${formatStepOutput(context.shared)}`)
  }
  const outputs = context.stepOutputs
  if (outputs && Object.keys(outputs).length > 0) {
    const deps = Object.entries(outputs).map(([stepId, output]) => (
      `### ${stepId}\n${formatStepOutput(output)}`
    ))
    sections.push(`## Upstream step outputs\n\n${deps.join('\n\n')}`)
  }
  if (sections.length === 0) return prompt
  return `${prompt}\n\n${sections.join('\n\n')}`
}

export function buildLlmPrompt(step: Step, context: ExecutionContext): string {
  return appendContextSections(substituteParams(step.prompt ?? '', context), context)
}

export function buildLlmSystemPrompt(step: Step): string {
  return [
    'You are assisting a Desktop workflow step.',
    'Return only the step result the workflow needs.',
    step.role ? `Role: ${step.role}` : '',
  ].filter(Boolean).join('\n')
}

export function buildTaskPrompt(step: Step, context: ExecutionContext, cwd: string): string {
  const lines = [
    `You are executing workflow task step "${step.id}" in workspace ${cwd}.`,
  ]
  if (step.role) lines.push(`Role: ${step.role}`)
  if (step.inputs) lines.push(`Inputs JSON:\n${JSON.stringify(step.inputs, null, 2)}`)
  if (step.acceptance?.length) {
    lines.push('Acceptance criteria:')
    for (const item of step.acceptance) lines.push(`- ${item}`)
  }
  if (step.prompt) lines.push(substituteParams(step.prompt, context))
  else lines.push('Complete the task and report concrete findings and next actions.')
  if (step.outputs?.length) {
    lines.push(`Produce these outputs when possible: ${step.outputs.join(', ')}`)
  }
  return appendContextSections(lines.join('\n'), context)
}

/** Default / clamp LLM completion budget for workflow steps (desktop parity). */
export function resolveLlmMaxTokens(step: Step): number {
  const raw = step.maxTokens
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.min(Math.max(Math.floor(raw), 256), 32_768)
  }
  return 8192
}
