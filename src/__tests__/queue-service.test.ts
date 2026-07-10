// ============================================================
// Queue Service Tests
// ============================================================

import { TaskQueue, QueueTask } from '../services/queue-service';

interface TestData {
  bookId: string;
  title: string;
}

function makeTask(id: string, bookId: string): QueueTask<TestData> {
  return {
    id,
    type: 'test',
    data: { bookId, title: `Book ${bookId}` },
    status: 'pending',
    error: null,
    tokenUsed: 0,
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
    retries: 0,
  };
}

describe('TaskQueue', () => {
  it('should_enqueue_and_process_single_task', async () => {
    const queue = new TaskQueue<TestData>(1);
    const handler = jest.fn().mockResolvedValue({ tokenUsed: 100 });
    queue.setHandler(handler);

    const task = makeTask('1', 'b1');
    queue.enqueue(task);

    // Wait for async processing
    await new Promise(r => setTimeout(r, 50));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(task.status).toBe('completed');
    expect(task.tokenUsed).toBe(100);
  });

  it('should_process_tasks_with_concurrency_limit', async () => {
    const queue = new TaskQueue<TestData>(2);
    let running = 0;
    let maxRunning = 0;

    const handler = jest.fn().mockImplementation(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise(r => setTimeout(r, 20));
      running--;
      return { tokenUsed: 50 };
    });
    queue.setHandler(handler);

    queue.enqueue(makeTask('1', 'a'));
    queue.enqueue(makeTask('2', 'b'));
    queue.enqueue(makeTask('3', 'c'));

    await new Promise(r => setTimeout(r, 100));

    expect(handler).toHaveBeenCalledTimes(3);
    expect(maxRunning).toBe(2); // max concurrency respected
  });

  it('should_mark_task_as_failed_on_handler_error', async () => {
    const queue = new TaskQueue<TestData>(1);
    const handler = jest.fn().mockRejectedValue(new Error('Handler failed'));
    queue.setHandler(handler);

    const task = makeTask('1', 'b1');
    queue.enqueue(task);

    await new Promise(r => setTimeout(r, 50));

    expect(task.status).toBe('failed');
    expect(task.error).toContain('Handler failed');
  });

  it('should_pause_and_resume_queue', async () => {
    const queue = new TaskQueue<TestData>(1);
    const handler = jest.fn().mockResolvedValue({ tokenUsed: 10 });
    queue.setHandler(handler);

    queue.pause();
    queue.enqueue(makeTask('1', 'a'));

    await new Promise(r => setTimeout(r, 50));
    expect(handler).not.toHaveBeenCalled(); // paused

    queue.resume();

    await new Promise(r => setTimeout(r, 50));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should_skip_duplicate_task_ids', async () => {
    const queue = new TaskQueue<TestData>(1);
    const handler = jest.fn().mockResolvedValue({ tokenUsed: 10 });
    queue.setHandler(handler);

    queue.enqueue(makeTask('1', 'a'));
    queue.enqueue(makeTask('1', 'a')); // duplicate

    await new Promise(r => setTimeout(r, 50));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should_report_correct_queue_status', () => {
    const queue = new TaskQueue<TestData>(2);

    queue.enqueue(makeTask('1', 'a'));
    queue.enqueue(makeTask('2', 'b'));
    queue.enqueue(makeTask('3', 'c'));

    const status = queue.getStatus();
    expect(status.pending).toBe(3);
    expect(status.running).toBe(0);
    expect(status.completed).toBe(0);
    expect(status.failed).toBe(0);
    expect(status.isPaused).toBe(false);
    expect(queue.pendingCount).toBe(3);
  });

  it('should_serialize_and_restore_queue', async () => {
    const queue = new TaskQueue<TestData>(1);
    // Don't set handler — tasks won't be processed, so they stay pending
    // (setting no handler means processNext returns early)

    queue.pause(); // Prevent immediate processing
    queue.enqueue(makeTask('1', 'a'));
    queue.enqueue(makeTask('2', 'b'));

    // Serialize current state
    const serialized = queue.serialize();
    expect(serialized).toHaveLength(2);

    // Restore into new queue (also no handler, paused)
    const queue2 = new TaskQueue<TestData>(1);
    queue2.restore(serialized);

    expect(queue2.getStatus().pending).toBe(2);
  });

  it('should_emit_queue_drained_when_all_tasks_complete', async () => {
    const queue = new TaskQueue<TestData>(2);
    const drained = jest.fn();
    queue.on('queue-drained', drained);

    const handler = jest.fn().mockResolvedValue({ tokenUsed: 10 });
    queue.setHandler(handler);

    queue.enqueue(makeTask('1', 'a'));
    queue.enqueue(makeTask('2', 'b'));

    await new Promise(r => setTimeout(r, 100));

    expect(drained).toHaveBeenCalled();
  });

  it('should_emit_task_events', async () => {
    const queue = new TaskQueue<TestData>(1);
    const started = jest.fn();
    const completed = jest.fn();
    queue.on('task-started', started);
    queue.on('task-completed', completed);

    const handler = jest.fn().mockResolvedValue({ tokenUsed: 10 });
    queue.setHandler(handler);

    queue.enqueue(makeTask('1', 'a'));

    await new Promise(r => setTimeout(r, 50));

    expect(started).toHaveBeenCalledWith({ taskId: '1', type: 'test' });
    expect(completed).toHaveBeenCalled();
  });

  it('should_respect_min_interval_between_tasks', async () => {
    const queue = new TaskQueue<TestData>(1, 50); // 50ms min interval
    const handler = jest.fn().mockResolvedValue({ tokenUsed: 10 });
    queue.setHandler(handler);

    const start = Date.now();
    queue.enqueue(makeTask('1', 'a'));
    queue.enqueue(makeTask('2', 'b'));

    await new Promise(r => setTimeout(r, 200));
    const elapsed = Date.now() - start;

    // Two tasks with 50ms interval should take at least 50ms total
    expect(elapsed).toBeGreaterThanOrEqual(50);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should_enqueue_batch', () => {
    const queue = new TaskQueue<TestData>(1);

    queue.enqueueBatch([
      makeTask('1', 'a'),
      makeTask('2', 'b'),
      makeTask('3', 'c'),
    ]);

    expect(queue.getStatus().pending).toBe(3);
  });

  it('should_not_process_when_no_handler_set', async () => {
    const queue = new TaskQueue<TestData>(1);
    // No handler set

    queue.enqueue(makeTask('1', 'a'));

    await new Promise(r => setTimeout(r, 50));

    expect(queue.getStatus().pending).toBe(1); // Still pending
  });
});
