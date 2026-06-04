/**
 * lib/orchestration/events.mjs — in-process run lifecycle event bus.
 *
 * The orchestration runtime persists runs to a store and appends durable JSONL
 * traces, but has no live pub/sub a server can stream from. This is that
 * primitive: a process-local EventEmitter keyed by runId so an HTTP SSE handler
 * can subscribe to a single run's transitions (planned → running → per-task →
 * completed) and forward them to a thin client. Events are lightweight status
 * deltas — never task output or any credential — so the stream stays cheap and
 * secret-free; clients fetch full run records (envelope-guarded) for outputs.
 *
 * Process-local by design: it streams runs executing in THIS process. Durable,
 * cross-process history lives in the run store and the trace log.
 */

import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(0);

function channel(runId) {
  return `run:${runId}`;
}

/**
 * Emit a run lifecycle event. Stamps runId + an ISO timestamp; callers pass a
 * small status delta (type, status, taskId, role, executor, error).
 *
 * @param {string} runId
 * @param {object} event
 */
export function emitRunEvent(runId, event = {}) {
  if (!runId) return;
  bus.emit(channel(runId), { runId, at: new Date().toISOString(), ...event });
}

/**
 * Subscribe to one run's events.
 *
 * @param {string} runId
 * @param {(event:object)=>void} handler
 * @returns {() => void} unsubscribe
 */
export function onRunEvent(runId, handler) {
  const ch = channel(runId);
  bus.on(ch, handler);
  return () => bus.off(ch, handler);
}

// Cooperative, between-task cancellation. executeRun checks this before each
// task and stops cleanly if set — an honest soft cancel (it cannot abort a
// model call already in flight), not a forced kill.

const cancelled = new Set();

export function requestCancel(runId) {
  if (runId) cancelled.add(runId);
}

export function isCancelRequested(runId) {
  return cancelled.has(runId);
}

export function clearCancel(runId) {
  cancelled.delete(runId);
}
