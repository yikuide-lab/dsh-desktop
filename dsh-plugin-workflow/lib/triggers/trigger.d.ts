/**
 * Trigger System for Workflow Engine
 * Supports cron, event, and manual triggers
 */
import type { TriggerType } from '../engine/models.js';
export interface TriggerConfig {
    type: TriggerType;
    schedule?: string;
    source?: string;
    on?: string;
    filter?: string;
    workflowName: string;
    params?: Record<string, unknown>;
}
export interface TriggerRecord {
    id: string;
    config: TriggerConfig;
    enabled: boolean;
    lastTriggered?: string;
    nextTrigger?: string;
    createdAt: string;
}
export interface TriggerEvent {
    source: string;
    name: string;
    data?: Record<string, unknown>;
    timestamp: string;
}
/**
 * Evaluate a trigger filter against an event.
 * Empty filter matches all. Clauses are comma-separated AND expressions of `path=value`.
 * Paths: `source`, `name`, or dotted `data.*` (e.g. `data.status=ok`).
 */
export declare function evaluateTriggerFilter(filter: string | undefined, event: TriggerEvent): boolean;
export declare class TriggerManager {
    private triggers;
    private timers;
    private eventListeners;
    private onTrigger;
    constructor(onTrigger: (config: TriggerConfig) => void);
    /**
     * Add a trigger
     */
    add(config: TriggerConfig): TriggerRecord;
    /** Rehydrate a previously persisted trigger record. */
    restore(record: TriggerRecord): void;
    /**
     * Remove a trigger
     */
    remove(id: string): boolean;
    /**
     * Enable a trigger
     */
    enable(id: string): void;
    /**
     * Disable a trigger
     */
    disable(id: string): void;
    /**
     * List all triggers
     */
    list(): TriggerRecord[];
    /**
     * Get a trigger by ID
     */
    get(id: string): TriggerRecord | undefined;
    /**
     * Fire an event
     */
    fireEvent(event: TriggerEvent): void;
    /**
     * Subscribe to events
     */
    on(eventName: string, listener: (event: TriggerEvent) => void): () => void;
    /**
     * Manual trigger
     */
    manual(triggerId: string, params?: Record<string, unknown>): void;
    /**
     * Schedule a trigger
     */
    private scheduleTrigger;
    /**
     * Trigger a workflow
     */
    private triggerWorkflow;
    /**
     * Stop all triggers
     */
    stop(): void;
}
//# sourceMappingURL=trigger.d.ts.map