import { describe, expect, it } from 'vitest'
import { parseWorkflow, validateWorkflow, StepType, type Workflow } from '../src/engine/models.ts'

function yamlWithStep(stepYaml: string): string {
  return `apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: field-types
spec:
  steps:
${stepYaml}
`
}

describe('step field type narrowing at parse', () => {
  it('rejects a non-string run', async () => {
    await expect(parseWorkflow(yamlWithStep(
      '    - id: s\n      type: script\n      run: 42',
    ))).rejects.toThrow(/field "run" must be a string/)
  })

  it('rejects a non-numeric timeout', async () => {
    await expect(parseWorkflow(yamlWithStep(
      '    - id: s\n      type: script\n      run: echo hi\n      timeout: "600"',
    ))).rejects.toThrow(/field "timeout" must be a non-negative number/)
  })

  it('rejects a non-string prompt', async () => {
    await expect(parseWorkflow(yamlWithStep(
      '    - id: l\n      type: llm\n      prompt: 42',
    ))).rejects.toThrow(/field "prompt" must be a string/)
  })

  it('rejects a non-string question', async () => {
    await expect(parseWorkflow(yamlWithStep(
      '    - id: a\n      type: approval\n      question: [not, a, string]\n      options: [approved]',
    ))).rejects.toThrow(/field "question" must be a string/)
  })

  it('rejects non-string options', async () => {
    await expect(parseWorkflow(yamlWithStep(
      '    - id: a\n      type: approval\n      question: ok?\n      options: [approved, 42]',
    ))).rejects.toThrow(/field "options" must be an array of strings/)
  })

  it('rejects a non-string ref', async () => {
    await expect(parseWorkflow(yamlWithStep(
      '    - id: c\n      type: sub_workflow\n      ref: 42',
    ))).rejects.toThrow(/field "ref" must be a string/)
  })

  it('rejects a non-string env value', async () => {
    await expect(parseWorkflow(yamlWithStep(
      '    - id: s\n      type: script\n      run: echo hi\n      env:\n        A: 42',
    ))).rejects.toThrow(/field "env.A" must be a string/)
  })

  it('rejects a negative retries', async () => {
    await expect(parseWorkflow(yamlWithStep(
      '    - id: s\n      type: script\n      run: echo hi\n      retries: -1',
    ))).rejects.toThrow(/field "retries" must be a non-negative number/)
  })

  it('rejects an invalid on_failure', async () => {
    await expect(parseWorkflow(yamlWithStep(
      '    - id: s\n      type: script\n      run: echo hi\n      on_failure: explode',
    ))).rejects.toThrow(/field "on_failure" must be fail, skip, or compensate/)
  })

  it('rejects compensation without a string run', async () => {
    await expect(parseWorkflow(yamlWithStep(
      '    - id: s\n      type: script\n      run: echo hi\n      on_failure: compensate\n      compensation:\n        run: 42',
    ))).rejects.toThrow(/field "compensation.run" must be a string/)
  })

  it('rejects non-numeric ui coordinates', async () => {
    await expect(parseWorkflow(yamlWithStep(
      '    - id: s\n      type: script\n      run: echo hi\n      ui:\n        x: "1"\n        y: 2',
    ))).rejects.toThrow(/field "ui" must be an object with numeric x\/y/)
  })

  it('accepts well-typed fields and round-trips them', async () => {
    const wf = await parseWorkflow(yamlWithStep(
      '    - id: s\n      type: script\n      run: echo hi\n      timeout: 30\n      retries: 1\n      on_failure: skip\n      env:\n        A: b\n      ui:\n        x: 1\n        y: 2',
    ))
    const step = wf.spec.steps[0]!
    expect(step.run).toBe('echo hi')
    expect(step.timeout).toBe(30)
    expect(step.retries).toBe(1)
    expect(step.on_failure).toBe('skip')
    expect(step.env).toEqual({ A: 'b' })
    expect(step.ui).toEqual({ x: 1, y: 2 })
  })
})

describe('step field type validation (programmatic)', () => {
  function workflowWith(partial: Record<string, unknown>): Workflow {
    return {
      apiVersion: 'workflow-wise/v1',
      kind: 'Workflow',
      metadata: { name: 'field-types-prog' },
      spec: {
        steps: [{ id: 's', type: StepType.Script, run: 'echo hi', ...partial } as never],
      },
    }
  }

  it('flags a non-string run', () => {
    const result = validateWorkflow(workflowWith({ run: 42 }))
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.path.endsWith('.run') && e.message.includes('must be a string'))).toBe(true)
  })

  it('flags a non-numeric timeout', () => {
    const result = validateWorkflow(workflowWith({ timeout: '600' }))
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.path.endsWith('.timeout'))).toBe(true)
  })

  it('flags non-string options on an approval step', () => {
    const wf: Workflow = {
      apiVersion: 'workflow-wise/v1',
      kind: 'Workflow',
      metadata: { name: 'field-types-approval' },
      spec: {
        steps: [{ id: 'a', type: StepType.Approval, question: 'ok?', options: [42] } as never],
      },
    }
    const result = validateWorkflow(wf)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.path.endsWith('.options') && e.message.includes('array of strings'))).toBe(true)
  })

  it('flags a non-string ref on a sub_workflow step', () => {
    const wf: Workflow = {
      apiVersion: 'workflow-wise/v1',
      kind: 'Workflow',
      metadata: { name: 'field-types-ref' },
      spec: {
        steps: [{ id: 'c', type: StepType.SubWorkflow, ref: 42 } as never],
      },
    }
    const result = validateWorkflow(wf)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.path.endsWith('.ref') && e.message.includes('must be a string'))).toBe(true)
  })
})
