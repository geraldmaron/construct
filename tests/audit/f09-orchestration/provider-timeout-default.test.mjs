/**
 * tests/audit/f09-orchestration/provider-timeout-default.test.mjs — proof.
 *
 * The provider worker HTTP timeout defaulted to 200ms (lib/orchestration/worker.mjs),
 * so every real LLM call aborted before the provider could respond and
 * provider-backed orchestration was dead by default. openai-python and
 * anthropic-sdk-python both default the overall request timeout to 600000ms; this
 * fix raises Construct's floor to 120000ms (still >= the 60000ms acceptance bar)
 * without implementing the full timeout/connect/retry policy owned by
 * AC#4.
 *
 * Two proofs: (1) with no override env, the resolved default is minute-scale
 * (>= 60000ms), not the old 200ms; (2) black-box — a fake provider that responds
 * after ~1s is NOT aborted when no timeout env is set. No real provider is
 * contacted: fetchImpl is an injected stub, and the API key is a dummy injected
 * through env (hermetic-when-explicit).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { runTaskViaProvider, PROVIDER_TIMEOUT_DEFAULT_MS } from '../../../lib/orchestration/worker.mjs';
import { resolveNonNegativeSetting } from '../../../lib/env-config.mjs';

const MODEL = 'openai/gpt-4o-mini';
const ENV = { OPENROUTER_API_KEY: 'sk-test-not-a-real-key' };
const TASK = { role: 'architect', reason: null, handoffContract: null };
const RUN = { request: { summary: 'default the provider timeout to minute-scale' } };

// A fetch that resolves after ~1s with a minimal OpenRouter-shaped response — the
// exact shape of a real provider that answers within the "real call responds in
// ~1s" acceptance bar.

function delayedFetch(delayMs) {
  return async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    };
  };
}

test('[construct-o6t8.1] production provider timeout default is minute-scale, not 200ms', () => {
  // Asserts the real exported constant and the worker's shared resolver, not a value
  // recomputed inside the test — a regression that lowered the default would fail here.
  assert.ok(PROVIDER_TIMEOUT_DEFAULT_MS >= 60000, `default provider timeout must be >= 60000ms, not 200ms. default=${PROVIDER_TIMEOUT_DEFAULT_MS}`);
  const resolvedNoEnv = resolveNonNegativeSetting({}, 'CONSTRUCT_PROVIDER_TIMEOUT_MS', PROVIDER_TIMEOUT_DEFAULT_MS);
  assert.equal(resolvedNoEnv, PROVIDER_TIMEOUT_DEFAULT_MS, 'unset env must resolve to the production default');
});

test('[construct-o6t8.1] garbage or negative provider timeout falls back to the default (no NaN AbortSignal)', () => {
  const garbage = resolveNonNegativeSetting({ CONSTRUCT_PROVIDER_TIMEOUT_MS: 'abc' }, 'CONSTRUCT_PROVIDER_TIMEOUT_MS', PROVIDER_TIMEOUT_DEFAULT_MS);
  assert.equal(garbage, PROVIDER_TIMEOUT_DEFAULT_MS, 'non-numeric env must fall back, not become NaN (AbortSignal.timeout(NaN) aborts instantly)');
  const negative = resolveNonNegativeSetting({ CONSTRUCT_PROVIDER_TIMEOUT_MS: '-100' }, 'CONSTRUCT_PROVIDER_TIMEOUT_MS', PROVIDER_TIMEOUT_DEFAULT_MS);
  assert.equal(negative, PROVIDER_TIMEOUT_DEFAULT_MS, 'negative env must fall back');
  const explicit = resolveNonNegativeSetting({ CONSTRUCT_PROVIDER_TIMEOUT_MS: '5000' }, 'CONSTRUCT_PROVIDER_TIMEOUT_MS', PROVIDER_TIMEOUT_DEFAULT_MS);
  assert.equal(explicit, 5000, 'a valid positive override must be honored');
});

test('[construct-o6t8.1] runTaskViaProvider does not abort a provider that responds after ~1s with no timeout env set', async () => {
  const fetchImpl = delayedFetch(1000);
  const result = await runTaskViaProvider({ task: TASK, run: RUN, model: MODEL, provider: 'openrouter', env: ENV, fetchImpl, chainOfThought: 'hidden' });

  assert.equal(result.output, 'ok', 'provider response was lost — a ~1s response must not be aborted by the default timeout');
});
