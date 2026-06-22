/**
 * lib/chat/harness/driver.mjs — normalized harness driver contract for the
 * construct terminal chat surface.
 *
 * A driver runs the agent loop and normalizes its streaming output into one event
 * model, so the transparency engine and the TUI never depend on how the loop is
 * produced. ADR-0041: Construct's owned loop (apps/chat/engine) implements this
 * contract; the union stays the stable seam between the engine and the renderers.
 * Every driver exposes the same shape:
 *   start()             opens a session and returns { sessionId, capabilities }
 *   prompt(text, opts)  async-iterable of normalized events for one turn; opts may
 *                       carry { model, sandbox, permissionMode } when the host supports them
 *   cancel()            aborts the active turn
 *   stop()              tears down the host process / connection
 *   listModels()        optional: returns [{ id, label, ... }] when the host can enumerate models
 *
 * Normalized event union consumed by the rest of the surface:
 *   { type: 'thinking',    text, messageId }      agent internal reasoning chunk
 *   { type: 'text',        text, messageId }      agent message chunk
 *   { type: 'plan',        entries }              planned path / task entries
 *   { type: 'tool_call',   id, title, kind, status }
 *   { type: 'tool_update', id, status, content }
 *   { type: 'usage',       tokens, cost, context, model }
 *                          tokens: { input, output, cacheRead, cacheWrite, reasoning, total }
 *                          cost:   { amount, currency }  context: { used, size }
 *                          every field optional — adapters emit only what the host
 *                          reports (no fabricated splits)
 *   { type: 'specialist',  role, status, detail } construct orchestration overlay
 *   { type: 'permission',  requestId, toolCall, options }
 *   { type: 'notice',      level, code, message } surface-visible advisory (e.g. context-pressure)
 *   { type: 'context_continuation', packet, compacted } persisted continuation packet (construct-6zga.1.10)
 *   { type: 'error',       message }
 *   { type: 'done',        stopReason }
 *
 * Keeping this union stable is what lets ACP agents and per-host adapters be
 * swapped without touching the transparency or rendering layers.
 */

export const EVENT_TYPES = Object.freeze({
  THINKING: 'thinking',
  TEXT: 'text',
  PLAN: 'plan',
  TOOL_CALL: 'tool_call',
  TOOL_UPDATE: 'tool_update',
  USAGE: 'usage',
  SPECIALIST: 'specialist',
  PERMISSION: 'permission',
  NOTICE: 'notice',
  CONTEXT_CONTINUATION: 'context_continuation',
  ERROR: 'error',
  DONE: 'done',
});

// A single-producer/single-consumer queue that is also an async iterable. The
// line-router pushes normalized events as they arrive; the turn loop awaits them
// until the producer closes the queue on stop reason or error.

export class AsyncEventQueue {
  constructor() {
    this.buffer = [];
    this.waiters = [];
    this.closed = false;
  }

  push(value) {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.buffer.push(value);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length) this.waiters.shift()({ value: undefined, done: true });
  }

  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.buffer.length) return Promise.resolve({ value: this.buffer.shift(), done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
