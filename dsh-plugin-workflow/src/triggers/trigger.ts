/**
 * Trigger System for Workflow Engine
 * Supports cron, event, and manual triggers
 */

import { randomUUID } from 'node:crypto';
import type { Trigger, TriggerType } from '../engine/models.ts';

// ============================================================================
// Types
// ============================================================================

export interface TriggerConfig {
  type: TriggerType;
  schedule?: string;     // 5-field cron expression
  timezone?: string;
  source?: string;       // event source
  on?: string;           // event name
  filter?: string;       // filter expression
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

// ============================================================================
// Cron Parser (simplified 5-field)
// ============================================================================

interface CronField {
  type: 'any' | 'values';
  values: number[];
}

interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

function parseCronField(field: string, min: number, max: number): CronField {
  if (field === '*') {
    return { type: 'any', values: [] };
  }

  const values: number[] = [];

  for (const part of field.split(',')) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number);
      for (let i = start; i <= end; i++) {
        values.push(i);
      }
    } else if (part.includes('/')) {
      const [start, step] = part.split('/').map(Number);
      for (let i = start; i <= max; i += step) {
        values.push(i);
      }
    } else {
      values.push(Number(part));
    }
  }

  return { type: 'values', values };
}

function parseCron(expression: string): ParsedCron {
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

function matchesCron(date: Date, cron: ParsedCron): boolean {
  const checks = [
    { field: cron.minute, value: date.getMinutes() },
    { field: cron.hour, value: date.getHours() },
    { field: cron.dayOfMonth, value: date.getDate() },
    { field: cron.month, value: date.getMonth() + 1 },
    { field: cron.dayOfWeek, value: date.getDay() },
  ];

  return checks.every(({ field, value }) => {
    if (field.type === 'any') return true;
    return field.values.includes(value);
  });
}

function getNextCronTime(expression: string, after: Date): Date {
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
  private triggers: Map<string, TriggerRecord> = new Map();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private eventListeners: Map<string, Set<(event: TriggerEvent) => void>> = new Map();
  private onTrigger: (config: TriggerConfig) => void;

  constructor(onTrigger: (config: TriggerConfig) => void) {
    this.onTrigger = onTrigger;
  }

  /**
   * Add a trigger
   */
  add(config: TriggerConfig): TriggerRecord {
    const id = `trigger-${randomUUID().slice(0, 8)}`;
    const record: TriggerRecord = {
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

  /**
   * Remove a trigger
   */
  remove(id: string): boolean {
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
  enable(id: string): void {
    const trigger = this.triggers.get(id);
    if (trigger) {
      trigger.enabled = true;
      this.scheduleTrigger(trigger);
    }
  }

  /**
   * Disable a trigger
   */
  disable(id: string): void {
    const trigger = this.triggers.get(id);
    if (trigger) {
      trigger.enabled = false;
      const timer = this.timers.get(id);
      if (timer) {
        clearTimeout(timer);
        this.timers.delete(id);
      }
    }
  }

  /**
   * List all triggers
   */
  list(): TriggerRecord[] {
    return Array.from(this.triggers.values());
  }

  /**
   * Get a trigger by ID
   */
  get(id: string): TriggerRecord | undefined {
    return this.triggers.get(id);
  }

  /**
   * Fire an event
   */
  fireEvent(event: TriggerEvent): void {
    // Check event-based triggers
    for (const trigger of this.triggers.values()) {
      if (!trigger.enabled) continue;
      if (trigger.config.type !== 'event') continue;
      if (trigger.config.source && trigger.config.source !== event.source) continue;
      if (trigger.config.on && trigger.config.on !== event.name) continue;

      // TODO: Evaluate filter expression
      if (trigger.config.filter) {
        // Simplified filter evaluation
      }

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
  on(eventName: string, listener: (event: TriggerEvent) => void): () => void {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, new Set());
    }
    this.eventListeners.get(eventName)!.add(listener);

    return () => {
      this.eventListeners.get(eventName)?.delete(listener);
    };
  }

  /**
   * Manual trigger
   */
  manual(triggerId: string, params?: Record<string, unknown>): void {
    const trigger = this.triggers.get(triggerId);
    if (!trigger) {
      throw new Error(`Trigger not found: ${triggerId}`);
    }

    const config = { ...trigger.config, params };
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
  private scheduleTrigger(record: TriggerRecord): void {
    if (!record.enabled) return;

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
        record.nextTrigger = getNextCronTime(record.config.schedule!, new Date()).toISOString();
        this.scheduleTrigger(record);
      }, delay);

      this.timers.set(record.id, timer);
    }
  }

  /**
   * Trigger a workflow
   */
  private triggerWorkflow(record: TriggerRecord, event: TriggerEvent): void {
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
  stop(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}

// ============================================================================
// Event Sources
// ============================================================================

export interface EventSource {
  name: string;
  start(): void;
  stop(): void;
  on(event: string, handler: (data: unknown) => void): void;
}

/**
 * Webhook Event Source
 */
export class WebhookSource implements EventSource {
  name = 'webhook';
  private handlers: Map<string, Set<(data: unknown) => void>> = new Map();
  private server: ReturnType<typeof import('node:http').createServer> | null = null;

  constructor(private port: number = 18080) {}

  start(): void {
    const http = require('node:http');
    this.server = http.createServer((req, res) => {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            const eventName = req.url?.slice(1) || 'default';
            this.emit(eventName, data);
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true }));
          } catch {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
      } else {
        res.writeHead(405);
        res.end(JSON.stringify({ error: 'Method not allowed' }));
      }
    });

    this.server.listen(this.port);
  }

  stop(): void {
    this.server?.close();
  }

  on(event: string, handler: (data: unknown) => void): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  private emit(event: string, data: unknown): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(data);
      }
    }
  }
}

/**
 * File Watcher Event Source
 */
export class FileWatcherSource implements EventSource {
  name = 'file';
  private watcher: ReturnType<typeof import('node:fs').watch> | null = null;
  private handlers: Map<string, Set<(data: unknown) => void>> = new Map();

  constructor(private watchPath: string) {}

  start(): void {
    const fs = require('node:fs');
    this.watcher = fs.watch(this.watchPath, { recursive: true }, (event, filename) => {
      this.emit('change', { event, filename, path: this.watchPath });
    });
  }

  stop(): void {
    this.watcher?.close();
  }

  on(event: string, handler: (data: unknown) => void): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  private emit(event: string, data: unknown): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(data);
      }
    }
  }
}
