/**
 * OpenAI-compatible request/response mapping for workflow-backed completions.
 */

import type { Run, TranscriptEvent } from 'dsh-plugin-workflow/engine'

export interface OpenAiChatMessage {
  role?: string
  content?: unknown
}

export interface OpenAiChatCompletionRequest {
  model?: string
  messages?: OpenAiChatMessage[]
  stream?: boolean
  /** Optional Desktop workspace id for startBoundRun. */
  workspace?: string
}

export interface OpenAiErrorBody {
  error: {
    message: string
    type: string
    code: string | null
    param: string | null
  }
}

/** Flatten OpenAI message content into plain text. */
export function flattenMessageContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text ?? '')
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (content == null) return ''
  return String(content)
}

/** Last user message text (PROMPT / PROBLEM input). */
export function extractUserPrompt(messages: readonly OpenAiChatMessage[] | undefined): string {
  if (!messages?.length) return ''
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.role === 'user') {
      return flattenMessageContent(message.content).trim()
    }
  }
  return ''
}

export function buildRunParamsFromPrompt(
  prompt: string,
  workspaceId?: string,
): Record<string, string> {
  const params: Record<string, string> = {}
  if (workspaceId) {
    params.workspaceId = workspaceId
    params.sessionId = workspaceId
  }
  if (prompt) {
    params.PROMPT = prompt
    params.prompt = prompt
    params.PROBLEM = prompt
    params.problem = prompt
    params.QUESTION = prompt
    params.question = prompt
  }
  return params
}

export function openaiError(
  message: string,
  options?: { type?: string; code?: string | null; param?: string | null },
): OpenAiErrorBody {
  return {
    error: {
      message,
      type: options?.type ?? 'invalid_request_error',
      code: options?.code ?? null,
      param: options?.param ?? null,
    },
  }
}

export function buildModelsList(
  workflows: readonly { metadata: { name: string; title?: string }; createdAt?: string }[],
  createdFallback = Math.floor(Date.now() / 1000),
): {
  object: 'list'
  data: Array<{
    id: string
    object: 'model'
    created: number
    owned_by: string
  }>
} {
  return {
    object: 'list',
    data: workflows.map((workflow) => ({
      id: workflow.metadata.name,
      object: 'model' as const,
      created: createdFallback,
      owned_by: 'dsh-workflow',
    })),
  }
}

/** Prefer structured step outputs, then transcript text payloads. */
export function extractRunAssistantText(
  run: Run,
  transcript: readonly TranscriptEvent[],
): string {
  const taskTexts: string[] = []
  for (const task of Object.values(run.tasks ?? {})) {
    if (task.status !== 'completed' || task.result == null) continue
    if (typeof task.result === 'string') {
      taskTexts.push(task.result)
      continue
    }
    if (typeof task.result === 'object') {
      const record = task.result as Record<string, unknown>
      for (const key of ['text', 'output', 'content', 'answer']) {
        if (typeof record[key] === 'string' && record[key]) {
          taskTexts.push(record[key] as string)
          break
        }
      }
    }
  }
  if (taskTexts.length > 0) return taskTexts[taskTexts.length - 1]!

  const fromTranscript = transcriptTextEvents(transcript)
  if (fromTranscript.length > 0) return fromTranscript.join('\n')

  if (run.error) return `Workflow failed: ${run.error}`
  return `Workflow ${run.status}`
}

export function transcriptTextEvents(events: readonly TranscriptEvent[]): string[] {
  const out: string[] = []
  for (const event of events) {
    const text = transcriptEventText(event)
    if (text) out.push(text)
  }
  return out
}

export function transcriptEventText(event: TranscriptEvent): string | null {
  const data = event.data
  if (!data || typeof data !== 'object') return null
  for (const key of ['text', 'output', 'content', 'response', 'result', 'stdout']) {
    const value = (data as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

export function isTerminalRunStatus(status: string): boolean {
  return status === 'completed'
    || status === 'failed'
    || status === 'aborted'
    || status === 'rejected'
}

export function buildChatCompletionResponse(input: {
  id: string
  model: string
  content: string
  created?: number
}): Record<string, unknown> {
  const created = input.created ?? Math.floor(Date.now() / 1000)
  return {
    id: input.id,
    object: 'chat.completion',
    created,
    model: input.model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: input.content },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }
}

export function buildChatCompletionChunk(input: {
  id: string
  model: string
  delta: string
  finishReason?: string | null
  created?: number
}): Record<string, unknown> {
  const created = input.created ?? Math.floor(Date.now() / 1000)
  return {
    id: input.id,
    object: 'chat.completion.chunk',
    created,
    model: input.model,
    choices: [{
      index: 0,
      delta: input.delta ? { content: input.delta } : {},
      finish_reason: input.finishReason ?? null,
    }],
  }
}

export function formatSseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}
