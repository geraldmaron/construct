/**
 * lib/embed/scheduler.mjs — interval-based task scheduler for embed mode.
 *
 * Lightweight alternative to a full cron library — runs tasks at fixed
 * intervals, tracks last-run times, and supports graceful shutdown.
 * Zero external deps.
 *
 * One-shot startup jobs MUST set `repeat: false`. With `repeat: true`
 * (the default) and `intervalMs: 0`, the timer fires on every event-loop
 * tick — the bug that filled embed-daemon.log to 34 GB before this option
 * was added.
 */

export class Scheduler {
  #tasks = new Map();   // id → { fn, intervalMs, lastRun, timer, label, repeat }
  #running = false;

  /**
   * Register a task. Returns the task id.
   * @param {string} label       - Human-readable name for logging
   * @param {number} intervalMs  - How often to run (ms); ignored when repeat is false
   * @param {Function} fn        - Async function to call; receives { label, lastRun }
   * @param {object} [opts]
   * @param {boolean} [opts.runImmediately=false] - Run once before first interval fires
   * @param {boolean} [opts.unref=false]           - Call timer.unref() so this task does not keep the event loop alive (use in tests)
   * @param {boolean} [opts.repeat=true]           - When false, the task is one-shot: it runs once (immediately if runImmediately, otherwise after intervalMs) and never re-arms. Required for startup jobs that pass intervalMs: 0.
   */
  register(label, intervalMs, fn, { runImmediately = false, unref = false, repeat = true } = {}) {
    const id = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const task = { label, intervalMs, fn, lastRun: null, timer: null, runImmediately, unref, repeat };
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
        clearTimeout(task.timer);
        task.timer = null;
      }
    }
  }

  /**
   * Remove a task by id.
   */
  unregister(id) {
    const task = this.#tasks.get(id);
    if (task?.timer) {
      clearInterval(task.timer);
      clearTimeout(task.timer);
    }
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
      repeat: t.repeat,
    }));
  }

  #startTask(id, task, runImmediately) {
    if (runImmediately) {
      this.#runTask(task).catch((err) => {
        process.stderr.write(`[scheduler] ${task.label} error: ${err.message}\n`);
      });
    }

    // One-shot jobs do not re-arm. When runImmediately is true, the task has
    // already executed and no further scheduling is needed. When false, a
    // single setTimeout fires once at intervalMs.
    if (!task.repeat) {
      if (!runImmediately) {
        task.timer = setTimeout(() => {
          task.timer = null;
          this.#runTask(task).catch((err) => {
            process.stderr.write(`[scheduler] ${task.label} error: ${err.message}\n`);
          });
        }, task.intervalMs);
        if (task.unref && task.timer.unref) task.timer.unref();
      }
      return;
    }

    task.timer = setInterval(() => {
      this.#runTask(task).catch((err) => {
        process.stderr.write(`[scheduler] ${task.label} error: ${err.message}\n`);
      });
    }, task.intervalMs);
    // Tasks keep the event loop alive by default. Tests opt in to unref().
    if (task.unref && task.timer.unref) task.timer.unref();
  }

  async #runTask(task) {
    task.lastRun = new Date();
    await task.fn({ label: task.label, lastRun: task.lastRun });
  }
}
