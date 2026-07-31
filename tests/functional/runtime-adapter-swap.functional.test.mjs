/**
 * tests/functional/runtime-adapter-swap.functional.test.mjs
 * replacement proof: a real (in-repo, not spike-disposable) runtime-adapter
 * swap with rollback, generalizing spike F's gh-CLI-to-REST provider swap
 * (docs/notes/research/workspace-control-plane/synthesis/spike-f-runtime-replacement.md)
 * to the runtime-adapter layer.
 *
 * Spans multiple components (the registry, a real OS-subprocess adapter, an
 * HTTP-transport adapter, and the shared contract), so by the
 * multi-component rule this lives in tests/functional/, not tests/. The
 * "before" adapter spawns a real node child process (no DI'd fake spawn) so
 * the in-flight-safety assertion below exercises a genuine OS process, the
 * same rigor spike F's in-flight-safety-check.mjs harness used.
 *
 * Proves, against the real lib/runtime/contract modules in an isolated
 * tmpdir:
 *   1. Two differently-transported adapters (real subprocess vs HTTP fetch)
 *      both conform to the same contract through the same registry key.
 *   2. Swapping the registry's factory for a key mid-flight does not affect
 *      an already-resolved instance's in-flight invocation (directive §11 F's
 *      "existing runs finish safely" property, at the registry layer).
 *   3. Rolling the swap back restores the original adapter's behavior,
 *      proving the swap is a one-line, reversible registry edit — not a
 *      one-way migration.
 */
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createRuntimeRegistry } from '../../lib/runtime/contract/registry.mjs';
import { createProcessTransportRuntime } from '../../lib/runtime/contract/adapters/coding/process-transport.mjs';
import { createClaudeApiRuntime } from '../../lib/runtime/contract/adapters/coding/claude-api.mjs';
import { validate } from '../../lib/runtime/contract/interface.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const ECHO_WORKER_SOURCE = `#!/usr/bin/env node
const delayMs = Number(process.argv[2] || 0);
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  setTimeout(() => {
    process.stdout.write('ECHO:' + input.trim());
    process.exit(0);
  }, delayMs);
});
`;

/**
 * A real OS-subprocess coding runtime: node spawns node, no fake spawnFn.
 * Represents the "before" side of the swap this test proves — the same
 * process-transport shape claude-cli.mjs specializes.
 */
function createRealSubprocessAdapter(scriptPath) {
  return createProcessTransportRuntime({
    name: 'real-subprocess-v1',
    kind: 'coding',
    command: process.execPath,
    buildArgs: (input) => [scriptPath, String(input?.delayMs ?? 0)],
    buildStdin: (input) => input?.text ?? '',
    parseOutput: (stdout) => stdout,
  });
}

/**
 * A fake fetch standing in for a real Anthropic Messages API call — the
 * "after" side of the swap. Delays its response when the request carries a
 * slow marker, so the timing of the mid-flight swap below is deterministic.
 */
function fakeMessagesApiFetch() {
  return async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const prompt = body.messages[0].content;
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: [{ text: `API-ECHO:${prompt}` }] }),
    };
  };
}

test('registry swap: real-process adapter swaps to HTTP adapter, in-flight call survives, rollback restores original', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-runtime-swap-'));
  try {
    const scriptPath = join(dir, 'echo-worker.mjs');
    writeFileSync(scriptPath, ECHO_WORKER_SOURCE);
    chmodSync(scriptPath, 0o755);

    const registry = createRuntimeRegistry();
    registry.register('coding-under-test', () => createRealSubprocessAdapter(scriptPath));

    // Step 1 — both "before" and "after" implementations conform to the
    // same contract, resolved through the same registry key.

    const before = registry.resolve('coding-under-test');
    assert.ok(validate(before).valid, `real-process adapter failed validation: ${validate(before).errors.join('; ')}`);
    await before.init();

    const afterProbe = createClaudeApiRuntime({ name: 'claude-api-v2', apiKey: '__TEST_API_KEY__', fetchFn: fakeMessagesApiFetch() });
    assert.ok(validate(afterProbe).valid, `HTTP adapter failed validation: ${validate(afterProbe).errors.join('; ')}`);

    // Step 2 — start a slow, real-subprocess invocation on the resolved
    // "before" instance, then swap the registry entry mid-flight.

    const invocationId = 'in-flight-across-swap';
    const inFlight = before.invoke({ input: { delayMs: 300, text: 'hello-before' } }, { invocationId });

    await new Promise((resolve) => setTimeout(resolve, 50));
    registry.register('coding-under-test', () => createClaudeApiRuntime({ name: 'claude-api-v2', apiKey: '__TEST_API_KEY__', fetchFn: fakeMessagesApiFetch() }));

    // Step 3 — the in-flight real-subprocess call is unaffected by the
    // registry swap: it completes with the original adapter's behavior.

    const inFlightResult = await inFlight;
    assert.equal(inFlightResult.status, 'completed');
    assert.equal(inFlightResult.output, 'ECHO:hello-before');

    // Step 4 — a fresh resolve() after the swap returns the new
    // implementation, proving the swap is live for new callers.

    const afterSwap = registry.resolve('coding-under-test');
    assert.equal(afterSwap.name, 'claude-api-v2');
    await afterSwap.init();
    const afterResult = await afterSwap.invoke({ input: { prompt: 'hello-after' } }, {});
    assert.equal(afterResult.status, 'completed');
    assert.equal(afterResult.output, 'API-ECHO:hello-after');

    // Step 5 — rollback: re-registering the original factory restores the
    // pre-swap behavior exactly, the registry-level equivalent of spike F's
    // `git revert` proof.

    registry.register('coding-under-test', () => createRealSubprocessAdapter(scriptPath));
    const rolledBack = registry.resolve('coding-under-test');
    assert.equal(rolledBack.name, 'real-subprocess-v1');
    await rolledBack.init();
    const rollbackResult = await rolledBack.invoke({ input: { delayMs: 0, text: 'hello-again' } }, {});
    assert.equal(rollbackResult.status, 'completed');
    assert.equal(rollbackResult.output, 'ECHO:hello-again');
  } finally {
    rmTmpDir(dir);
  }
});

test('registry swap: an unrelated resolve() before the swap is unaffected by a later re-registration', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-runtime-swap-unrelated-'));
  try {
    const scriptPath = join(dir, 'echo-worker.mjs');
    writeFileSync(scriptPath, ECHO_WORKER_SOURCE);
    chmodSync(scriptPath, 0o755);

    const registry = createRuntimeRegistry();
    registry.register('coding-under-test', () => createRealSubprocessAdapter(scriptPath));

    const heldInstance = registry.resolve('coding-under-test');
    await heldInstance.init();

    registry.register('coding-under-test', () => createClaudeApiRuntime({ name: 'claude-api-v2', apiKey: '__TEST_API_KEY__', fetchFn: fakeMessagesApiFetch() }));

    const result = await heldInstance.invoke({ input: { delayMs: 0, text: 'still-old' } }, {});
    assert.equal(result.output, 'ECHO:still-old');
    assert.equal(heldInstance.name, 'real-subprocess-v1');
  } finally {
    rmTmpDir(dir);
  }
});
