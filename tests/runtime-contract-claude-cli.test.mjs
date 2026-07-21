/**
 * tests/runtime-contract-claude-cli.test.mjs — conformance + unit tests for
 * the claude-cli coding-runtime adapter. Uses a fake spawnFn (no real
 * `claude` binary spawned).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runConformanceSuite } from '../lib/runtime/contract/conformance.mjs';
import { createClaudeCliRuntime } from '../lib/runtime/contract/adapters/coding/claude-cli.mjs';
import { createFakeSpawn } from './helpers/fake-child-process.mjs';

// The conformance suite invokes both invokeEcho and invokeSlow against the
// SAME runtime instance, so the fake spawnFn keys its delay off the prompt
// rather than off construction-time config.

function conformanceSpawn(command, args, opts) {
  const prompt = args[1];
  const delayMs = prompt === 'CONFORMANCE_SLOW' ? 200 : 0;
  return createFakeSpawn({ stdout: `echoed:${prompt}`, delayMs })(command, args, opts);
}

runConformanceSuite({
  name: 'claude-cli (coding)',
  createRuntime: () => createClaudeCliRuntime({ name: 'claude-cli-test', spawnFn: conformanceSpawn }),
  initConfig: {},
  invokeEcho: (runtime) => runtime.invoke({ input: { prompt: 'hello' } }, {}),
  invokeSlow: (runtime, invocationId) =>
    runtime.invoke({ input: { prompt: 'CONFORMANCE_SLOW' } }, { invocationId }),
  supportsInterrupt: true,
});

describe('claude-cli runtime — unit behavior', () => {
  it('passes the prompt as -p <prompt>', async () => {
    let seenArgs;
    const spawnFn = (command, args, opts) => {
      seenArgs = args;
      return createFakeSpawn({ stdout: 'ok' })(command, args, opts);
    };
    const runtime = createClaudeCliRuntime({ name: 'args-check', spawnFn });
    await runtime.init();
    await runtime.invoke({ input: { prompt: 'do the thing' } }, {});
    assert.deepEqual(seenArgs, ['-p', 'do the thing']);
  });

  it('maps a non-zero exit code to status "failed"', async () => {
    const runtime = createClaudeCliRuntime({
      name: 'failing',
      spawnFn: createFakeSpawn({ code: 1 }),
    });
    await runtime.init();
    const result = await runtime.invoke({ input: { prompt: 'x' } }, {});
    assert.equal(result.status, 'failed');
    assert.equal(result.error.name, 'InvocationError');
  });

  it('cancel() kills the in-flight subprocess before it exits', async () => {
    const runtime = createClaudeCliRuntime({
      name: 'killable',
      spawnFn: createFakeSpawn({ stdout: 'never seen', delayMs: 5000 }),
    });
    await runtime.init();
    const invocationId = 'kill-me';
    const inFlight = runtime.invoke({ input: { prompt: 'slow' } }, { invocationId });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const cancelResult = await runtime.cancel(invocationId);
    const result = await inFlight;
    assert.equal(cancelResult.cancelled, true);
    assert.equal(result.status, 'cancelled');
  });
});
