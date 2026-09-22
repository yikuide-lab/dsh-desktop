import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowPlugin } from 'dsh-plugin-workflow'
import {
  buildModelsList,
  buildRunParamsFromPrompt,
  extractUserPrompt,
  flattenMessageContent,
  openaiError,
} from '../src/desktop-workflow-openai-protocol.ts'
import { WorkflowOpenAiServer } from '../src/desktop-workflow-openai-server.ts'
import { generateWorkflowOpenAiApiKey } from '../src/desktop-workflow-openai-settings.ts'

function mockPlugin(overrides: Partial<WorkflowPlugin> = {}): WorkflowPlugin {
  const run = {
    id: 'run-1',
    workflowName: 'demo-wf',
    status: 'completed' as const,
    startedAt: '2026-01-01T00:00:00Z',
    tasks: {
      a: {
        id: 't-a',
        stepId: 'a',
        status: 'completed' as const,
        result: 'hello from workflow',
        dispatches: [],
      },
    },
  }
  return {
    listWorkflows: vi.fn(async () => [{
      apiVersion: 'workflow-wise/v1',
      kind: 'Workflow',
      metadata: { name: 'demo-wf', title: 'Demo' },
      spec: { steps: [] },
    }]),
    getWorkflow: vi.fn(async (name: string) => (
      name === 'demo-wf'
        ? {
          apiVersion: 'workflow-wise/v1',
          kind: 'Workflow',
          metadata: { name: 'demo-wf' },
          spec: { steps: [] },
        }
        : null
    )),
    startRun: vi.fn(async () => run),
    startBoundRun: vi.fn(async () => run),
    getRun: vi.fn(async () => run),
    getTranscript: vi.fn(async () => ({
      events: [{ id: 'e1', type: 'text', ts: '2026-01-01T00:00:01Z', data: { text: 'stream chunk' } }],
      nextAfter: undefined,
    })),
    ...overrides,
  } as unknown as WorkflowPlugin
}

describe('workflow openai protocol', () => {
  it('joins system + user messages into the workflow PROMPT', () => {
    expect(flattenMessageContent([{ type: 'text', text: 'part' }])).toBe('part')
    expect(extractUserPrompt([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'mid' },
      { role: 'user', content: '  last prompt  ' },
    ])).toBe('sys\n\nfirst\n\nlast prompt')
    expect(buildRunParamsFromPrompt('q', 'ws-1')).toMatchObject({
      PROMPT: 'q',
      PROBLEM: 'q',
      workspaceId: 'ws-1',
    })
  })

  it('maps workflows to OpenAI models list', () => {
    const list = buildModelsList([{
      metadata: { name: 'code-review' },
      createdAt: '2026-01-01',
    }], 1700000000)
    expect(list.data[0]).toEqual({
      id: 'code-review',
      object: 'model',
      created: 1700000000,
      owned_by: 'dsh-workflow',
    })
  })

  it('shapes OpenAI errors without stacks', () => {
    expect(openaiError('nope', { code: 'model_not_found' }).error).toMatchObject({
      message: 'nope',
      code: 'model_not_found',
    })
  })
})

describe('workflow openai server', () => {
  let stateDir: string
  let server: WorkflowOpenAiServer | null = null
  const apiKey = generateWorkflowOpenAiApiKey()

  afterEach(async () => {
    await server?.stop()
    server = null
    if (stateDir) await rm(stateDir, { recursive: true, force: true })
  })

  async function startLoopback(plugin: WorkflowPlugin): Promise<string> {
    stateDir = await mkdtemp(join(tmpdir(), 'dsh-wf-openai-'))
    server = new WorkflowOpenAiServer({
      plugin,
      stateDir,
      settings: {
        enabled: true,
        bindHost: '127.0.0.1',
        port: 0,
        apiKey,
        maxBodyBytes: 64 * 1024,
        maxConcurrent: 2,
      },
    })
    await server.start()
    const status = server.getStatus()
    expect(status.listening).toBe(true)
    expect(status.usingTls).toBe(false)
    expect(status.baseUrl).toBeTruthy()
    return status.baseUrl!
  }

  it('rejects missing Bearer token', async () => {
    const baseUrl = await startLoopback(mockPlugin())
    const response = await fetch(`${baseUrl}/models`)
    expect(response.status).toBe(401)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('invalid_api_key')
  })

  it('lists workflows as models', async () => {
    const baseUrl = await startLoopback(mockPlugin())
    const response = await fetch(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { data: Array<{ id: string }> }
    expect(body.data.map(entry => entry.id)).toEqual(['demo-wf'])
  })

  it('returns model_not_found for unknown workflow', async () => {
    const baseUrl = await startLoopback(mockPlugin())
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'missing-wf',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    expect(response.status).toBe(404)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('model_not_found')
  })

  it('returns non-stream completion from a finished run', async () => {
    const plugin = mockPlugin()
    const baseUrl = await startLoopback(plugin)
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'demo-wf',
        stream: false,
        messages: [{ role: 'user', content: 'solve this' }],
      }),
    })
    expect(response.status).toBe(200)
    const body = await response.json() as {
      choices: Array<{ message: { content: string } }>
    }
    expect(body.choices[0]?.message.content).toBe('hello from workflow')
    expect(plugin.startRun).toHaveBeenCalledWith(
      'demo-wf',
      expect.objectContaining({ PROMPT: 'solve this', PROBLEM: 'solve this' }),
    )
  })

  it('streams SSE chunks and ends with [DONE]', async () => {
    const baseUrl = await startLoopback(mockPlugin())
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'demo-wf',
        stream: true,
        messages: [{ role: 'user', content: 'stream me' }],
      }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const text = await response.text()
    expect(text).toContain('chat.completion.chunk')
    expect(text).toContain('stream chunk')
    expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true)
  })
})
