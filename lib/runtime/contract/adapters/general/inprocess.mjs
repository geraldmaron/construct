/**
 * lib/runtime/contract/adapters/general/inprocess.mjs — in-process runtime.
 *
 * Runs work by calling a caller-supplied handler function in the same
 * process/event loop — no subprocess, no network. Represents the "general"
 * runtime shape named in directive §17 E4: the default runtime for work
 * that doesn't need process or model isolation (a pure computation, a graph
 * query). Cancellation is cooperative: invoke() gives the handler an
 * AbortSignal via context; a handler that checks it can stop early, one that
 * ignores it cannot be forced to stop mid-call — the same cooperative
 * contract fetch()/AbortController use throughout Node, not a gap specific
 * to this adapter.
 */
import { randomUUID } from 'node:crypto';
import { RuntimeNotReadyError, InvocationError } from '../../errors.mjs';

export function createInProcessRuntime({ name = 'inprocess', handler } = {}) {
  if (typeof handler !== 'function') {
    throw new TypeError('createInProcessRuntime requires a handler(input, { signal }) function');
  }

  let ready = false;
  const controllers = new Map();

  return {
    name,
    kind: 'general',
    capabilities: ['interrupt', 'concurrent'],

    async init() {
      ready = true;
    },

    async health() {
      return { live: ready };
    },

    async invoke(request, context = {}) {
      if (!ready) throw new RuntimeNotReadyError(name);
      const invocationId = context.invocationId ?? randomUUID();
      const controller = new AbortController();
      controllers.set(invocationId, controller);

      try {
        const output = await handler(request?.input, { signal: controller.signal });
        return { id: invocationId, status: 'completed', output, error: null };
      } catch (err) {
        if (controller.signal.aborted) {
          return { id: invocationId, status: 'cancelled', output: null, error: null };
        }
        return {
          id: invocationId,
          status: 'failed',
          output: null,
          error: new InvocationError(err.message, { runtime: name, cause: err }),
        };
      } finally {
        controllers.delete(invocationId);
      }
    },

    async cancel(invocationId) {
      const controller = controllers.get(invocationId);
      if (!controller) return { cancelled: false, reason: 'unknown invocation id' };
      controller.abort();
      return { cancelled: true };
    },
  };
}
