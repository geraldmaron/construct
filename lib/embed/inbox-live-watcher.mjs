/**
 * lib/embed/inbox-live-watcher.mjs — reactive fs.watch wrapper around InboxWatcher.
 *
 * Registers a node:fs.watch listener on each inbox directory and triggers
 * `InboxWatcher.poll()` shortly after filesystem activity settles, so files
 * dropped into `inbox/` flow through ingest + the review queue in
 * seconds rather than waiting for the scheduler's next interval.
 *
 * Two limits keep this stable across platforms:
 *
 *   - Debounce window (default 750ms): batches a multi-file paste into one
 *     poll. fs.watch fires per-entry on Linux and sometimes twice per entry
 *     on macOS; debouncing collapses both cases.
 *
 *   - In-flight guard: if a poll is already running when an event fires,
 *     mark the watcher dirty and re-poll once the current one finishes.
 *     Prevents overlapping pgvector writes on rapid bursts.
 *
 * Inbox dirs are flat by design, so recursive watching is not required —
 * top-level fs.watch is enough and avoids the cross-platform recursive
 * issues that plague larger trees. fs.watch silently misses events on
 * network mounts and certain Docker volume drivers; correctness lives in
 * the scheduler poll, this watcher is a latency layer.
 */

import { watch } from 'node:fs';

const DEFAULT_DEBOUNCE_MS = 750;

export class InboxLiveWatcher {
  #inboxWatcher;
  #debounceMs;
  #watchFn;
  #onPoll;
  #onError;
  #handles = [];
  #pending = false;
  #running = false;
  #debounceTimer = null;
  #started = false;

  constructor({
    inboxWatcher,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    watchFn = watch,
    onPoll = () => {},
    onError = () => {},
  } = {}) {
    if (!inboxWatcher) throw new Error('InboxLiveWatcher: inboxWatcher is required');
    this.#inboxWatcher = inboxWatcher;
    this.#debounceMs = debounceMs;
    this.#watchFn = watchFn;
    this.#onPoll = onPoll;
    this.#onError = onError;
  }

  start() {
    if (this.#started) return { watched: this.#handles.length };
    this.#started = true;

    const dirs = this.#inboxWatcher.dirs();
    for (const dir of dirs) {
      try {
        const handle = this.#watchFn(dir, { persistent: true }, (eventType, filename) => {
          if (filename && filename.startsWith('.')) return;
          this.#trigger();
        });
        if (handle && typeof handle.on === 'function') {
          handle.on('error', (err) => this.#onError(err, dir));
        }
        this.#handles.push({ dir, handle });
      } catch (err) {
        this.#onError(err, dir);
      }
    }
    return { watched: this.#handles.length, dirs };
  }

  stop() {
    if (!this.#started) return;
    this.#started = false;
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }
    for (const { handle } of this.#handles) {
      try { handle.close?.(); } catch { /* ignore */ }
    }
    this.#handles = [];
  }

  #trigger() {
    if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null;
      this.#runPoll();
    }, this.#debounceMs);
  }

  async #runPoll() {
    if (this.#running) {
      this.#pending = true;
      return;
    }
    this.#running = true;
    try {
      const result = await this.#inboxWatcher.poll();
      this.#onPoll(result);
    } catch (err) {
      this.#onError(err, null);
    } finally {
      this.#running = false;
      if (this.#pending) {
        this.#pending = false;
        setImmediate(() => this.#runPoll());
      }
    }
  }
}
