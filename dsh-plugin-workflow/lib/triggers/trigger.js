/**
 * Trigger System for Workflow Engine
 * Supports cron, event, and manual triggers
 */
import { randomUUID } from 'node:crypto';
/**
 * Evaluate a trigger filter against an event.
 * Empty filter matches all. Clauses are comma-separated AND expressions of `path=value`.
 * Paths: `source`, `name`, or dotted `data.*` (e.g. `data.status=ok`).
 */
export function evaluateTriggerFilter(filter, event) {
    if (!filter || !filter.trim())
        return true;
    const clauses = filter.split(',').map((part) => part.trim()).filter(Boolean);
    return clauses.every((clause) => {
        const eq = clause.indexOf('=');
        if (eq <= 0)
            return false;
        const path = clause.slice(0, eq).trim();
        const expected = clause.slice(eq + 1).trim();
        const actual = lookupTriggerPath(event, path);
        return String(actual ?? '') === expected;
    });
}
function lookupTriggerPath(event, path) {
    if (path === 'source')
        return event.source;
    if (path === 'name')
        return event.name;
    if (path === 'timestamp')
        return event.timestamp;
    if (path === 'data')
        return event.data;
    if (path.startsWith('data.')) {
        let current = event.data;
        for (const segment of path.slice(5).split('.')) {
            if (!segment || current === null || typeof current !== 'object')
                return undefined;
            current = current[segment];
        }
        return current;
    }
    return undefined;
}
function parseCronField(field, min, max) {
    if (field === '*') {
        return { type: 'any', values: [] };
    }
    const values = [];
    for (const part of field.split(',')) {
        if (part.includes('-') && !part.includes('/')) {
            const [start, end] = part.split('-').map(Number);
            for (let i = start; i <= end; i++) {
                values.push(i);
            }
        }
        else if (part.includes('/')) {
            const [range, stepRaw] = part.split('/');
            const step = Number(stepRaw);
            if (!Number.isFinite(step) || step <= 0)
                continue;
            let start = min;
            let end = max;
            if (range === '*') {
                start = min;
            }
            else if (range.includes('-')) {
                const [rangeStart, rangeEnd] = range.split('-').map(Number);
                start = rangeStart;
                end = rangeEnd;
            }
            else if (range !== '') {
                start = Number(range);
            }
            for (let i = start; i <= end; i += step) {
                values.push(i);
            }
        }
        else {
            values.push(Number(part));
        }
    }
    return { type: 'values', values };
}
function parseCron(expression) {
    const fields = expression.split(' ');
    if (fields.length !== 5) {
        throw new Error('Invalid cron expression: must have 5 fields');
    }
    return {
        minute: parseCronField(fields[0], 0, 59),
        hour: parseCronField(fields[1], 0, 23),
        dayOfMonth: parseCronField(fields[2], 1, 31),
        month: parseCronField(fields[3], 1, 12),
        dayOfWeek: parseCronField(fields[4], 0, 6),
    };
}
function matchesCron(date, cron) {
    const checks = [
        { field: cron.minute, value: date.getMinutes() },
        { field: cron.hour, value: date.getHours() },
        { field: cron.dayOfMonth, value: date.getDate() },
        { field: cron.month, value: date.getMonth() + 1 },
        { field: cron.dayOfWeek, value: date.getDay() },
    ];
    return checks.every(({ field, value }) => {
        if (field.type === 'any')
            return true;
        return field.values.includes(value);
    });
}
function getNextCronTime(expression, after) {
    const cron = parseCron(expression);
    const next = new Date(after);
    next.setSeconds(0);
    next.setMilliseconds(0);
    next.setMinutes(next.getMinutes() + 1);
    // Search for next match (max 7 days)
    for (let i = 0; i < 7 * 24 * 60; i++) {
        if (matchesCron(next, cron)) {
            return next;
        }
        next.setMinutes(next.getMinutes() + 1);
    }
    throw new Error('No matching time found within 7 days');
}
// ============================================================================
// Trigger Manager
// ============================================================================
export class TriggerManager {
    triggers = new Map();
    timers = new Map();
    eventListeners = new Map();
    onTrigger;
    constructor(onTrigger) {
        this.onTrigger = onTrigger;
    }
    /**
     * Add a trigger
     */
    add(config) {
        const id = `trigger-${randomUUID().slice(0, 8)}`;
        const record = {
            id,
            config,
            enabled: true,
            createdAt: new Date().toISOString(),
        };
        if (config.type === 'cron' && config.schedule) {
            record.nextTrigger = getNextCronTime(config.schedule, new Date()).toISOString();
        }
        this.triggers.set(id, record);
        this.scheduleTrigger(record);
        return record;
    }
    /** Rehydrate a previously persisted trigger record. */
    restore(record) {
        const existing = this.timers.get(record.id);
        if (existing) {
            clearTimeout(existing);
            this.timers.delete(record.id);
        }
        this.triggers.set(record.id, record);
        this.scheduleTrigger(record);
    }
    /**
     * Remove a trigger
     */
    remove(id) {
        const timer = this.timers.get(id);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(id);
        }
        return this.triggers.delete(id);
    }
    /**
     * Enable a trigger
     */
    enable(id) {
        const trigger = this.triggers.get(id);
        if (!trigger) {
            throw new Error(`Trigger not found: ${id}`);
        }
        trigger.enabled = true;
        this.scheduleTrigger(trigger);
    }
    /**
     * Disable a trigger
     */
    disable(id) {
        const trigger = this.triggers.get(id);
        if (!trigger) {
            throw new Error(`Trigger not found: ${id}`);
        }
        trigger.enabled = false;
        const timer = this.timers.get(id);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(id);
        }
    }
    /**
     * List all triggers
     */
    list() {
        return Array.from(this.triggers.values());
    }
    /**
     * Get a trigger by ID
     */
    get(id) {
        return this.triggers.get(id);
    }
    /**
     * Fire an event
     */
    fireEvent(event) {
        // Check event-based triggers
        for (const trigger of this.triggers.values()) {
            if (!trigger.enabled)
                continue;
            if (trigger.config.type !== 'event')
                continue;
            if (trigger.config.source && trigger.config.source !== event.source)
                continue;
            if (trigger.config.on && trigger.config.on !== event.name)
                continue;
            if (!evaluateTriggerFilter(trigger.config.filter, event))
                continue;
            this.triggerWorkflow(trigger, event);
        }
        // Notify listeners
        const listeners = this.eventListeners.get(event.name);
        if (listeners) {
            for (const listener of listeners) {
                listener(event);
            }
        }
    }
    /**
     * Subscribe to events
     */
    on(eventName, listener) {
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, new Set());
        }
        this.eventListeners.get(eventName).add(listener);
        return () => {
            this.eventListeners.get(eventName)?.delete(listener);
        };
    }
    /**
     * Manual trigger
     */
    manual(triggerId, params) {
        const trigger = this.triggers.get(triggerId);
        if (!trigger) {
            throw new Error(`Trigger not found: ${triggerId}`);
        }
        this.triggerWorkflow(trigger, {
            source: 'manual',
            name: 'manual',
            data: params,
            timestamp: new Date().toISOString(),
        });
    }
    /**
     * Schedule a trigger
     */
    scheduleTrigger(record) {
        if (!record.enabled)
            return;
        if (record.config.type === 'cron' && record.config.schedule) {
            const nextTime = getNextCronTime(record.config.schedule, new Date());
            const delay = nextTime.getTime() - Date.now();
            const timer = setTimeout(() => {
                this.triggerWorkflow(record, {
                    source: 'cron',
                    name: 'cron',
                    timestamp: new Date().toISOString(),
                });
                // Schedule next
                record.nextTrigger = getNextCronTime(record.config.schedule, new Date()).toISOString();
                this.scheduleTrigger(record);
            }, delay);
            this.timers.set(record.id, timer);
        }
    }
    /**
     * Trigger a workflow
     */
    triggerWorkflow(record, event) {
        record.lastTriggered = event.timestamp;
        this.onTrigger({
            ...record.config,
            params: {
                ...record.config.params,
                triggerEvent: event,
            },
        });
    }
    /**
     * Stop all triggers
     */
    stop() {
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
    }
}
//# sourceMappingURL=trigger.js.map