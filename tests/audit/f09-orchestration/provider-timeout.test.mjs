/**
 * tests/audit/f09-orchestration/provider-timeout.red.mjs — F09 [R19] unbounded-provider proof.
 *
 * RED fixtures (must FAIL against current code). The provider worker backend issues
 * direct fetches with no AbortController/AbortSignal and no timeout
 * (lib/orchestration/worker.mjs callOpenRouter L179-183, callAnthropic L154-158,
 * callOpenAI L212-219, callCopilot L195-202). The fetch options are
 * `{ method, headers, body }` only. A provider that accepts the connection but never
 * responds therefore stalls the specialist task — and the whole sequenced run — for as
 * long as the socket stays open, with no deterministic bound (OWASP LLM unbounded
 * consumption, S12).
 *
 * Contract these encode (CX-AUDIT-ORCH-003): every provider call must be bounded by an
 * AbortSignal/timeout so a hung provider rejects within a deterministic window instead
 * of hanging the run. Two proofs: (1) white-box — the fetch options must include a
 * `signal`; (2) black-box — against a never-resolving fetch, runTaskViaProvider must
 * settle within a deterministic bound. No real provider is contacted: fetchImpl is an
 * injected stub that captures options and returns a never-resolving promise, and the
 * API key is a dummy injected through env (hermetic-when-explicit).
 *
 * Each fixture passes once the worker wires an AbortSignal/timeout onto its provider
 * fetches.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { runTaskViaProvider } from '../../../lib/orchestration/worker.mjs';

const MODEL = 'openai/gpt-4o-mini';

// Pin an explicit small timeout so this proof of boundedness is deterministic
// regardless of the production default (construct-neq9.6): the test must not
// depend on — nor silently re-manufacture — worker.mjs's default value. A
// timeout is retryable (construct-5wkl AC#4), so a hung provider is pinned to
// a single attempt here — this proof is about the per-call bound, not the
// separately-tested retry/backoff policy (tests/orchestration-worker.test.mjs).

const ENV = {
  OPENROUTER_API_KEY: 'sk-test-not-a-real-key',
  CONSTRUCT_PROVIDER_TIMEOUT_MS: '100',
  CONSTRUCT_PROVIDER_MAX_ATTEMPTS: '1',
};
const TASK = { role: 'architect', reason: null, handoffContract: null };
const RUN = { request: { summary: 'bound the provider call' } };

// A fetch that records the options it was called with and never settles — the exact
// shape of a provider that accepts the socket but never replies.

function neverResolvingFetch() {
  const calls = [];
  const impl = (url, opts = {}) => {
    calls.push({ url, opts });
    return new Promise(() => {});
  };
  return { impl, calls };
}

// A deterministic bound: if runTaskViaProvider has not settled by this margin, the call
// is unbounded. Kept comfortably above scheduling jitter while far below any real
// provider patience so the assertion is stable in CI.

const DETERMINISTIC_BOUND_MS = 300;

function settledWithin(promise, ms) {
  return Promise.race([
    promise.then(() => 'settled', () => 'settled'),
    new Promise((resolve) => setTimeout(() => resolve('still-pending'), ms)),
  ]);
}

test('[R19] provider worker fetch carries an AbortSignal (white-box)', async () => {
  const { impl, calls } = neverResolvingFetch();
  runTaskViaProvider({ task: TASK, run: RUN, model: MODEL, provider: 'openrouter', env: ENV, fetchImpl: impl, chainOfThought: 'hidden' }).catch(() => {});

  await new Promise((r) => setTimeout(r, 50));

  assert.equal(calls.length, 1, `precondition: the provider fetch was issued once. calls=${calls.length}`);
  assert.ok(
    'signal' in (calls[0].opts || {}),
    `provider fetch options carry no AbortSignal — a hung provider cannot be cancelled. `
      + `optsKeys=${Object.keys(calls[0].opts || {}).join(',')}`,
  );
  assert.ok(
    calls[0].opts.signal instanceof AbortSignal || (calls[0].opts.signal && typeof calls[0].opts.signal.aborted === 'boolean'),
    `provider fetch "signal" is not an AbortSignal. signal=${String(calls[0].opts.signal)}`,
  );
});

test('[R19] runTaskViaProvider rejects within a deterministic bound when the provider never responds (black-box)', async () => {
  const { impl } = neverResolvingFetch();
  const call = runTaskViaProvider({ task: TASK, run: RUN, model: MODEL, provider: 'openrouter', env: ENV, fetchImpl: impl, chainOfThought: 'hidden' });

  // Swallow the eventual rejection so it never surfaces as an unhandled rejection once
  // the timeout lands post-fix; the assertion below is what fails today.
  call.catch(() => {});

  const outcome = await settledWithin(call, DETERMINISTIC_BOUND_MS);
  assert.equal(
    outcome,
    'settled',
    `runTaskViaProvider was still pending after ${DETERMINISTIC_BOUND_MS}ms against a never-resolving provider; `
      + 'a hung provider stalls the run with no deterministic timeout (OWASP S12 unbounded consumption).',
  );
});
