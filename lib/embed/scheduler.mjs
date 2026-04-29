/**
 * lib/embed/scheduler.mjs — interval-based task scheduler for embed mode.
 *
 * Lightweight alternative to a full cron library — runs tasks at fixed
 * intervals, tracks last-run times, and supports graceful shutdown.
 * Zero external deps.
 */

export class Scheduler {
  #tasks = new Map();   // id → { fn, intervalMs, lastRun, timer, label }
  #running = false;

  /**
   * Register a task. Returns the task id.
   * @param {string} label       - Human-readable name for logging
   * @param {number} intervalMs  - How often to run (ms)
   * @param {Function} fn        - Async function to call; receives { label, lastRun }
   * @param {object} [opts]
   * @param {boolean} [opts.runImmediately=false] - Run once before first interval fires
   */
  register(label, intervalMs, fn, { runImmediately = false } = {}) {
    const id = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const task = { label, intervalMs, fn, lastRun: null, timer: null, runImmediately };
    this.#tasks.set(id, task);

    if (this.#running) {
      this.#startTask(id, task, runImmediately);
    }

    return id;
  }

  /**
   * Start all registered tasks.
   */
  start() {
    if (this.#running) return;
    this.#running = true;
    for (const [id, task] of this.#tasks) {
      this.#startTask(id, task, task.runImmediately);
    }
  }

  /**
   * Stop all tasks gracefully.
   */
  stop() {
    this.#running = false;
    for (const task of this.#tasks.values()) {
      if (task.timer) {
        clearInterval(task.timer);
        task.timer = null;
      }
    }
  }

  /**
   * Remove a task by id.
   */
  unregister(id) {
    const task = this.#tasks.get(id);
    if (task?.timer) clearInterval(task.timer);
    this.#tasks.delete(id);
  }

  /**
   * List registered tasks with their status.
   */
  status() {
    return [...this.#tasks.entries()].map(([id, t]) => ({
      id,
      label: t.label,
      intervalMs: t.intervalMs,
      lastRun: t.lastRun,
      active: Boolean(t.timer),
    }));
  }

  #startTask(id, task, runImmediately) {
    if (runImmediately) {
      this.#runTask(task).catch((err) => {
        process.stderr.write(`[scheduler] ${task.label} error: ${err.message}\n`);
      });
    }
    task.timer = setInterval(() => {
      this.#runTask(task).catch((err) => {
        process.stderr.write(`[scheduler] ${task.label} error: ${err.message}\n`);
      });
    }, task.intervalMs);
    // Prevent the scheduler from keeping the process alive if nothing else is running
    if (task.timer.unref) task.timer.unref();
  }

  async #runTask(task) {
    task.lastRun = new Date();
    await task.fn({ label: task.label, lastRun: task.lastRun });
  }
}
