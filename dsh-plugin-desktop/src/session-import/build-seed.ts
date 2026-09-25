/** Build DSH SessionEvent seed arrays from imported text turns. */

import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ImportedTurn } from './types.js'

/**
 * Map imported turns into a minimal valid seed:
 * turn/start → user/assistant messages → turn/end (one turn wrapping history).
 */
export function buildSeedEvents(turns: readonly ImportedTurn[]): SessionEvent[] {
  if (turns.length === 0) return []

  const events: SessionEvent[] = []
  let seq = 0
  const baseTime = turns[0]?.timeMs ?? Date.now()
  events.push({
    type: 'turn/start',
    seq: SessionSeq(seq++),
    time: baseTime,
    data: { turn: 1 },
  })

  let step = 0
  for (const turn of turns) {
    if (turn.role === 'user') {
      events.push({
        type: 'user/message',
        seq: SessionSeq(seq++),
        time: turn.timeMs || baseTime,
        data: createUserMessage({
          content: [{ type: 'text', text: turn.text }],
          source: { kind: 'user' },
        }),
        surfaceOp: 'append',
      })
      continue
    }
    step += 1
    events.push({
      type: 'assistant/message',
      seq: SessionSeq(seq++),
      time: turn.timeMs || baseTime,
      data: {
        turn: 1,
        step,
        message: createAssistantMessage({
          content: [{ type: 'text', text: turn.text }],
          source: { provider: 'import', model: 'harness-import' },
        }),
        stream: [],
      },
      surfaceOp: 'append',
    })
  }

  const endTime = turns[turns.length - 1]?.timeMs ?? baseTime
  events.push({
    type: 'turn/end',
    seq: SessionSeq(seq++),
    time: endTime + 1,
    data: { turn: 1, reason: { kind: 'completed' } },
  })
  return events
}
