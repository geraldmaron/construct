/**
 * tests/runtime-contract-inprocess.test.mjs — conformance + unit tests for
 * the in-process ("general") runtime adapter.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runConformanceSuite } from '../lib/runtime/contract/conformance.mjs';
import { createInProcessRuntime } from '../lib/runtime/contract/adapters/general/inprocess.mjs';

function sleepAbortable(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
  });
}

runConformanceSuite({
  name: 'inprocess (general)',
  createRuntime: () =>
    createInProcessRuntime({
      name: 'inprocess-test',
      handler: async (input, { signal }) => {
        if (input?.delayMs) await sleepAbortable(input.delayMs, signal);
        return input?.echo ?? 'ok';
      },
    }),
  initConfig: {},
  invokeEcho: (runtime) => runtime.invoke({ input: { echo: 'hello' } }, {}),
  invokeSlow: (runtime, invocationId) =>
    runtime.invoke({ input: { delayMs: 200, echo: 'slow' } }, { invocationId }),
  supportsInterrupt: true,
});

describe('inprocess runtime — unit behavior', () => {
  it('propagates the handler output verbatim', async () => {
    const runtime = createInProcessRuntime({
      name: 'echo',
      handler: async (input) => ({ doubled: (input?.n ?? 0) * 2 }),
    });
    await runtime.init();
    const result = await runtime.invoke({ input: { n: 21 } }, {});
    assert.deepEqual(result.output, { doubled: 42 });
  });

  it('maps a thrown handler error to status "failed" with an InvocationError', async () => {
    const runtime = createInProcessRuntime({
      name: 'thrower',
      handler: async () => {
        throw new Error('boom');
      },
    });
    await runtime.init();
    const result = await runtime.invoke({ input: {} }, {});
    assert.equal(result.status, 'failed');
    assert.equal(result.error.name, 'InvocationError');
    assert.match(result.error.message, /boom/);
  });
});
