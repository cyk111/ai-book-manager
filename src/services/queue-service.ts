// ============================================================
// Rate-Limited Task Queue — generic with persistence
// ============================================================

import { QueueError, generateCorrelationId } from '../errors';
import { Logger, NOOP_LOGGER } from '../logger';

// ---- Types ----

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface QueueTask<T = unknown> {
  id: string;
  type: string;
  data: T;
  status: TaskStatus;
  error: string | null;
  tokenUsed: number;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  retries: number;
}

export interface QueueStatus {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  isPaused: boolean;
}

export type TaskHandler<T> = (task: QueueTask<T>) => Promise<{ tokenUsed: number }>;

// ---- Queue Implementation ----

export class TaskQueue<T = unknown> {
  private queue: QueueTask<T>[] = [];
  private inProgress = new Set<string>();
  private _isPaused = false;
  private handler: TaskHandler<T> | null = null;
  private maxConcurrency: number;
  private minIntervalMs: number;
  private lastTaskEndTime = 0;
  private listeners: Map<string, Array<(...args: unknown[]) => void>> = new Map();
  private log: Logger;
  private onPersist: (() => void) | null = null;

  constructor(
    maxConcurrency: number = 1,
    minIntervalMs: number = 0,
    logger: Logger = NOOP_LOGGER,
    onPersist?: () => void,
  ) {
    this.maxConcurrency = maxConcurrency;
    this.minIntervalMs = minIntervalMs;
    this.log = logger;
    this.onPersist = onPersist || null;
  }

  // ---- Public API ----

  setHandler(handler: TaskHandler<T>): void {
    this.handler = handler;
  }

  enqueue(task: QueueTask<T>): void {
    if (this.queue.some(t => t.id === task.id)) {
      this.log.debug('Duplicate task skipped', { taskId: task.id });
      return;
    }
    this.queue.push(task);
    this.log.debug('Task enqueued', { taskId: task.id, type: task.type, queueLength: this.queue.length });
    this.emit('task-enqueued', task);
    this.persist();
    this.processNext();
  }

  enqueueBatch(tasks: QueueTask<T>[]): void {
    for (const task of tasks) {
      this.enqueue(task);
    }
  }

  pause(): void {
    this._isPaused = true;
    this.log.info('Queue paused', { pending: this.queue.length });
    this.emit('queue-paused', {});
  }

  resume(): void {
    this._isPaused = false;
    this.log.info('Queue resumed', { pending: this.queue.length });
    this.emit('queue-resumed', {});
    this.processNext();
  }

  getStatus(): QueueStatus {
    const all = [...this.queue, ...this.getAllInProgress()];
    return {
      pending: all.filter(t => t.status === 'pending').length,
      running: all.filter(t => t.status === 'running').length,
      completed: all.filter(t => t.status === 'completed').length,
      failed: all.filter(t => t.status === 'failed').length,
      isPaused: this._isPaused,
    };
  }

  get isPaused(): boolean {
    return this._isPaused;
  }

  get pendingCount(): number {
    return this.queue.filter(t => t.status === 'pending').length;
  }

  // ---- Events ----

  on(event: string, callback: (...args: unknown[]) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(callback);
  }

  off(event: string, callback: (...args: unknown[]) => void): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      this.listeners.set(event, handlers.filter(h => h !== callback));
    }
  }

  // ---- Persistence ----

  serialize(): QueueTask<T>[] {
    return [...this.queue];
  }

  restore(tasks: QueueTask<T>[]): void {
    // Only restore pending/failed tasks
    const restorable = tasks.filter(
      t => t.status === 'pending' || t.status === 'running',
    );
    // Reset running tasks back to pending
    for (const task of restorable) {
      if (task.status === 'running') {
        task.status = 'pending';
      }
    }
    this.queue = [...restorable, ...this.queue];
    this.log.info('Queue restored', { restoredCount: restorable.length });
    this.processNext();
  }

  // ---- Internal ----

  private getAllInProgress(): QueueTask<T>[] {
    const results: QueueTask<T>[] = [];
    for (const id of this.inProgress) {
      const task = this.queue.find(t => t.id === id);
      if (task) results.push(task);
    }
    return results;
  }

  private async processNext(): Promise<void> {
    if (this._isPaused) return;
    if (this.inProgress.size >= this.maxConcurrency) return;
    if (!this.handler) return;

    const now = Date.now();
    const elapsed = now - this.lastTaskEndTime;
    if (elapsed < this.minIntervalMs) {
      // Wait for rate limit interval
      setTimeout(() => this.processNext(), this.minIntervalMs - elapsed);
      return;
    }

    const task = this.queue.find(t => t.status === 'pending');
    if (!task) {
      // All tasks processed
      if (this.inProgress.size === 0) {
        this.emit('queue-drained', {});
      }
      return;
    }

    task.status = 'running';
    task.startedAt = Date.now();
    task.retries++;
    this.inProgress.add(task.id);

    this.emit('task-started', { taskId: task.id, type: task.type });
    this.log.debug('Task started', { taskId: task.id, type: task.type });

    try {
      const result = await this.handler!(task);
      task.status = 'completed';
      task.completedAt = Date.now();
      task.tokenUsed = result.tokenUsed;
      this.log.debug('Task completed', { taskId: task.id, tokenUsed: result.tokenUsed });
      this.emit('task-completed', { taskId: task.id, result });
    } catch (err) {
      task.status = 'failed';
      task.error = String(err);
      task.completedAt = Date.now();
      this.log.warn('Task failed', { taskId: task.id, error: String(err) });
      this.emit('task-failed', { taskId: task.id, error: String(err) });
    } finally {
      this.inProgress.delete(task.id);
      this.lastTaskEndTime = Date.now();
      this.persist();
      // Process next in queue
      this.processNext();
    }
  }

  private persist(): void {
    if (this.onPersist) {
      try { this.onPersist(); } catch { /* don't let persist errors break queue */ }
    }
  }

  private emit(event: string, data: unknown): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(data);
        } catch {
          // Don't let listener errors break the queue
        }
      }
    }
  }
}
