/**
 * RSI self-iteration: problem store, review iterations (deterministic stub and
 * Host reviewer), and the shared review prompt / verdict parsing.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkflowPlugin } from '../src/plugin.js'
import {
  buildRsiReviewPrompt,
  parseRsiReviewResponse,
  type RsiReviewRequest,
} from '../src/engine/rsi-review.js'

describe('RSI self-iterating improvement', () => {
  let stateDir: string
  let plugin: WorkflowPlugin

  afterEach(async () => {
    plugin?.stop()
    await plugin?.whenStopped()
    if (stateDir) await rm(stateDir, { recursive: true, force: true })
  })

  async function boot(): Promise<WorkflowPlugin> {
    stateDir = await mkdtemp(join(tmpdir(), 'dsh-workflow-rsi-'))
    plugin = new WorkflowPlugin({ stateDir, mcpEnabled: false, tickInterval: 50 })
    await plugin.init()
    return plugin
  }

  describe('problem store', () => {
    it('creates problems with defaults and lists them', async () => {
      const p = await boot()
      const { id } = await p.rsiCreateProblem({ title: '摘要质量' })
      expect(id).toBe(1)
      expect(await p.rsiListProblems()).toEqual([
        {
          id: 1, title: '摘要质量', domain: 'summarization',
          maxIterations: 5, status: 'draft', scenarioCount: 0,
        },
      ])
      const second = await p.rsiCreateProblem({
        title: 'Shorter summaries', domain: 'summarization', maxIterations: 2,
        reviewProviderId: 3, improvementCriteria: 'be shorter', baseYaml: 'apiVersion: x',
      })
      expect(second.id).toBe(2)
      expect((await p.rsiListProblems())[1]).toMatchObject({ id: 2, maxIterations: 2 })
    })

    it('deletes problems with their iterations and answers ok:false for unknown ids', async () => {
      const p = await boot()
      const { id } = await p.rsiCreateProblem({ title: 't', baseYaml: 'a: 1' })
      await p.rsiRunIteration(id)
      expect(await p.rsiDeleteProblem(id)).toEqual({ ok: true })
      expect(await p.rsiListProblems()).toEqual([])
      expect(await p.rsiGetIterations(id)).toEqual([])
      expect(await p.rsiDeleteProblem(id)).toEqual({ ok: false })
    })

    it('rejects iteration runs for unknown problems', async () => {
      const p = await boot()
      await expect(p.rsiRunIteration(42)).rejects.toThrow('problem not found')
      expect(await p.rsiGetIterations(42)).toEqual([])
    })
  })

  describe('iterations without a Host reviewer (deterministic stub)', () => {
    it('climbs the stub score and echoes the baseline YAML', async () => {
      const p = await boot()
      const { id } = await p.rsiCreateProblem({ title: 't', baseYaml: 'base: true', maxIterations: 3 })
      const first = await p.rsiRunIteration(id)
      expect(first).toEqual({
        iterationNumber: 0, reviewScore: 50,
        reviewFeedback: '迭代 0: 初始基线评估',
        improvedYaml: 'base: true',
      })
      const second = await p.rsiRunIteration(id)
      expect(second.reviewScore).toBe(60)
      expect(second.improvedYaml).toBe('base: true')
      const iterations = await p.rsiGetIterations(id)
      expect(iterations.map(i => i.status)).toEqual(['completed', 'completed'])
      expect((await p.rsiListProblems())[0]!.status).toBe('running')
    })

    it('completes the problem at maxIterations', async () => {
      const p = await boot()
      const { id } = await p.rsiCreateProblem({ title: 't', maxIterations: 2 })
      await p.rsiRunIteration(id)
      expect((await p.rsiListProblems())[0]!.status).toBe('running')
      await p.rsiRunIteration(id)
      expect((await p.rsiListProblems())[0]!.status).toBe('completed')
    })
  })

  describe('iterations with a Host reviewer', () => {
    it('stores the reviewer verdict and feeds the improvement forward', async () => {
      const p = await boot()
      const { id } = await p.rsiCreateProblem({
        title: 'Summaries', domain: 'summarization', maxIterations: 5,
        improvementCriteria: 'be concise', baseYaml: 'base: v0',
      })
      const seen: RsiReviewRequest[] = []
      p.setHostHooks({
        runRsiReview: async (request) => {
          seen.push(request)
          return {
            score: 88,
            feedback: `pass ${request.iterationNumber}: tightened steps`,
            improvedYaml: `base: v${request.iterationNumber + 1}`,
          }
        },
      })
      const first = await p.rsiRunIteration(id)
      expect(first).toEqual({
        iterationNumber: 0, reviewScore: 88,
        reviewFeedback: 'pass 0: tightened steps',
        improvedYaml: 'base: v1',
      })
      const second = await p.rsiRunIteration(id)
      expect(second.improvedYaml).toBe('base: v2')

      expect(seen).toHaveLength(2)
      expect(seen[0]).toMatchObject({
        problemId: id, title: 'Summaries', domain: 'summarization',
        improvementCriteria: 'be concise', iterationNumber: 0, yaml: 'base: v0',
      })
      expect(seen[0]!.priorFeedback).toBeUndefined()
      expect(seen[1]).toMatchObject({
        iterationNumber: 1, yaml: 'base: v1', priorFeedback: 'pass 0: tightened steps',
      })
      expect(await p.rsiGetIterations(id)).toMatchObject([
        { reviewScore: 88, improvedYaml: 'base: v1', status: 'completed' },
        { reviewScore: 88, improvedYaml: 'base: v2', status: 'completed' },
      ])
    })

    it('records a failed iteration when the reviewer throws', async () => {
      const p = await boot()
      const { id } = await p.rsiCreateProblem({ title: 't', baseYaml: 'base: v0' })
      p.setHostHooks({
        runRsiReview: async () => {
          throw new Error('LLM endpoint unreachable')
        },
      })
      const result = await p.rsiRunIteration(id)
      expect(result.reviewScore).toBe(0)
      expect(result.reviewFeedback).toBe('评审失败: LLM endpoint unreachable')
      expect(result.improvedYaml).toBe('base: v0')
      expect((await p.rsiGetIterations(id))[0]!.status).toBe('failed')
      expect((await p.rsiListProblems())[0]!.status).toBe('running')
    })
  })

  describe('review prompt and verdict parsing', () => {
    it('builds a prompt carrying the problem, criteria, prior feedback, and YAML', () => {
      const prompt = buildRsiReviewPrompt({
        problemId: 7, title: 'Fix ordering', domain: 'routing',
        improvementCriteria: 'fewer steps', iterationNumber: 2,
        yaml: 'spec: {}', priorFeedback: 'merge the two lint steps',
      })
      expect(prompt.system).toContain('JSON')
      expect(prompt.user).toContain('Fix ordering')
      expect(prompt.user).toContain('routing')
      expect(prompt.user).toContain('fewer steps')
      expect(prompt.user).toContain('merge the two lint steps')
      expect(prompt.user).toContain('spec: {}')
    })

    it('parses bare, prose-wrapped, and fenced JSON verdicts', () => {
      const verdict = JSON.stringify({ score: 82, feedback: ' good ', improvedYaml: 'a: 2' })
      const expected = { score: 82, feedback: 'good', improvedYaml: 'a: 2' }
      expect(parseRsiReviewResponse(verdict, 'a: 1')).toEqual(expected)
      expect(parseRsiReviewResponse(`Here you go:\n${verdict}\nEnjoy!`, 'a: 1')).toEqual(expected)
      expect(parseRsiReviewResponse(`\`\`\`json\n${verdict}\n\`\`\``, 'a: 1')).toEqual(expected)
    })

    it('clamps the score and falls back to the input YAML and a placeholder note', () => {
      expect(parseRsiReviewResponse(JSON.stringify({ score: 150, feedback: 'x', improvedYaml: 'a: 2' }), 'a: 1').score).toBe(100)
      expect(parseRsiReviewResponse(JSON.stringify({ score: -3, feedback: 'x', improvedYaml: 'a: 2' }), 'a: 1').score).toBe(0)
      expect(parseRsiReviewResponse(JSON.stringify({ score: 'high', feedback: 'x', improvedYaml: 'a: 2' }), 'a: 1').score).toBe(0)
      expect(parseRsiReviewResponse(JSON.stringify({ score: 70, feedback: '   ', improvedYaml: '  ' }), 'a: 1')).toEqual({
        score: 70, feedback: '(no review feedback)', improvedYaml: 'a: 1',
      })
    })

    it('rejects non-JSON verdicts', () => {
      expect(() => parseRsiReviewResponse('I cannot help with that.', 'a: 1')).toThrow(/JSON/)
      expect(() => parseRsiReviewResponse('42', 'a: 1')).toThrow(/JSON/)
      expect(() => parseRsiReviewResponse('[]', 'a: 1')).toThrow(/JSON/)
      expect(() => parseRsiReviewResponse('', 'a: 1')).toThrow(/JSON/)
    })
  })
})
