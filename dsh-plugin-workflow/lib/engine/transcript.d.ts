/**
 * Append-only workflow run transcripts for interaction tracking.
 */
export type TranscriptEventType = 'run.start' | 'run.complete' | 'run.fail' | 'run.abort' | 'run.orphan' | 'dispatch.submit' | 'dispatch.settle' | 'gate.resolve' | 'llm.request' | 'llm.response' | 'task.request' | 'task.response' | 'script.result' | 'error';
export interface TranscriptEvent {
    ts: string;
    type: TranscriptEventType;
    stepId?: string;
    dispatchId?: string;
    data?: Record<string, unknown>;
}
/** Truncate large strings before persisting transcript payloads. */
export declare function truncateTranscriptText(value: string, max?: number): string;
/** Build a JSONL transcript path for a run. */
export declare function transcriptPath(stateDir: string, runId: string): string;
/** Append one transcript event (creates parent dirs as needed). */
export declare function appendTranscriptEvent(stateDir: string, runId: string, event: Omit<TranscriptEvent, 'ts'> & {
    ts?: string;
}): Promise<TranscriptEvent>;
/** Load transcript events with optional cursor pagination (`after` = last event ts). */
export declare function loadTranscriptEvents(stateDir: string, runId: string, options?: {
    after?: string;
    limit?: number;
}): Promise<{
    events: TranscriptEvent[];
    nextAfter?: string;
}>;
//# sourceMappingURL=transcript.d.ts.map