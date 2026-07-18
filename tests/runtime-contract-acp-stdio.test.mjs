/**
 * tests/runtime-contract-acp-stdio.test.mjs — conformance + unit tests for
 * the acp-stdio (process-or-ACP) coding-runtime adapter. Uses a fake
 * JSON-RPC-over-stdio child process (no real subprocess spawned).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runConformanceSuite } from '../lib/runtime/contract/conformance.mjs';
import { createAcpStdioRuntime } from '../lib/runtime/contract/adapters/coding/acp-stdio.mjs';

/**
 * A fake newline-delimited JSON-RPC child: echoes params back as the
 * result, delaying the response when params.prompt is the slow marker so
 * cancel/in-flight cases can exercise the request before it resolves.
 * A 'cancel' notification for a pending id is honored by never responding
 * to it (mirrors a real agent process dropping cancelled work).
 */
function createFakeAcpSpawn() {
  return function fakeSpawn() {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.exitCode = null;
    const dropped = new Set();
    let buffer = '';

    child.stdin = {
      write(chunk) {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          if (message.method === 'cancel') {
            dropped.add(message.params.id);
            continue;
          }
          const delayMs = message.params?.prompt === 'CONFORMANCE_SLOW' ? 200 : 0;
          setTimeout(() => {
            if (dropped.has(message.id)) return;
            child.stdout.emit(
              'data',
              Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: `echoed:${message.params?.prompt}` })}\n`),
            );
          }, delayMs);
        }
        return true;
      },
    };

    return child;
  };
}

runConformanceSuite({
  name: 'acp-stdio (process-or-ACP)',
  createRuntime: () =>
    createAcpStdioRuntime({ name: 'acp-test', command: 'fake-acp-agent', spawnFn: createFakeAcpSpawn() }),
  initConfig: {},
  invokeEcho: (runtime) => runtime.invoke({ input: { prompt: 'hello' } }, {}),
  invokeSlow: (runtime, invocationId) =>
    runtime.invoke({ input: { prompt: 'CONFORMANCE_SLOW' } }, { invocationId }),
  supportsInterrupt: true,
});

describe('acp-stdio runtime — unit behavior', () => {
  it('resolves invoke() with the JSON-RPC result field as output', async () => {
    const runtime = createAcpStdioRuntime({ name: 'result-check', command: 'fake', spawnFn: createFakeAcpSpawn() });
    await runtime.init();
    const result = await runtime.invoke({ input: { prompt: 'ping' } }, {});
    assert.equal(result.output, 'echoed:ping');
  });

  it('cancel() drops the pending response and resolves as "cancelled"', async () => {
    const runtime = createAcpStdioRuntime({ name: 'cancel-check', command: 'fake', spawnFn: createFakeAcpSpawn() });
    await runtime.init();
    const invocationId = 'cancel-me';
    const inFlight = runtime.invoke({ input: { prompt: 'CONFORMANCE_SLOW' } }, { invocationId });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const cancelResult = await runtime.cancel(invocationId);
    const result = await inFlight;
    assert.equal(cancelResult.cancelled, true);
    assert.equal(result.status, 'cancelled');
  });
});
