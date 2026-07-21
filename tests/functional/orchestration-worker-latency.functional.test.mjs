/**
 * tests/functional/orchestration-worker-latency.functional.test.mjs
 *
 * Guards construct-neq9.5: provider mocks that resolve instantly make any
 * timeout value pass trivially, so the production `CONSTRUCT_PROVIDER_TIMEOUT_MS`
 * default (`PROVIDER_TIMEOUT_DEFAULT_MS`, lib/orchestration/worker.mjs) was never
 * exercised against a call duration a real provider round-trip would take.
 * latentMockFetch resolves after a representative delay but still races
 * `timedFetch`'s `AbortSignal.timeout(timeoutMs)`, so a too-small timeout
 * genuinely rejects instead of the mock winning the race for free — both
 * directions are asserted so the harness itself is proven to discriminate.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { runTaskViaProvider, PROVIDER_TIMEOUT_DEFAULT_MS } from '../../lib/orchestration/worker.mjs';

const MODEL = 'anthropic/claude-sonnet-4-6';

function latentMockFetch(payload, delayMs) {
  return (url, opts) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    }), delayMs);
    opts?.signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(opts.signal.reason ?? new Error('aborted'));
    }, { once: true });
  });
}

test('[latency] a mock call with a representative 1.2s round-trip succeeds under the real production default timeout (no override set)', async () => {
  assert.ok(PROVIDER_TIMEOUT_DEFAULT_MS >= 1000, `production default (${PROVIDER_TIMEOUT_DEFAULT_MS}ms) must clear a plausible provider round-trip`);

  const task = { role: 'engineer', reason: 'implement the change', handoffContract: null };
  const run = { request: { summary: 'refactor the auth module' } };
  const fetchImpl = latentMockFetch({ content: [{ type: 'text', text: 'engineer result' }] }, 1200);

  const result = await runTaskViaProvider({
    task, run, model: MODEL, provider: 'anthropic',
    env: { ANTHROPIC_API_KEY: 'sk-test' },
    fetchImpl,
  });

  assert.equal(result.output, 'engineer result', 'a realistic-latency call must complete, not be killed by an over-tight default');
});

test('[latency] the harness genuinely discriminates: a deliberately small timeout still aborts a slow mock', async () => {
  const task = { role: 'engineer', reason: 'implement the change', handoffContract: null };
  const run = { request: { summary: 'refactor the auth module' } };
  const fetchImpl = latentMockFetch({ content: [{ type: 'text', text: 'should never arrive' }] }, 1000);

  await assert.rejects(
    runTaskViaProvider({
      task, run, model: MODEL, provider: 'anthropic',
      env: { ANTHROPIC_API_KEY: 'sk-test', CONSTRUCT_PROVIDER_TIMEOUT_MS: '100' },
      fetchImpl,
    }),
    /timed out|timeout/i,
    'reintroducing a sub-second timeout must reject a slower call, proving the mock does not win the race for free',
  );
});
