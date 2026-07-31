/**
 * tests/audit/f09-orchestration/remote-per-request-timeout.red.mjs — F09 [R20] proof.
 *
 * RED fixtures (must FAIL against current code). Remote orchestration
 * (lib/mcp/tools/orchestration-run.mjs runViaService L111-149) enforces an OVERALL
 * timeout_ms, but only as a deadline CHECKED INSIDE the poll loop (L132-135). The
 * individual fetches are not separately bounded: the initial POST (L117) carries no
 * AbortSignal, and each poll GET (L140) carries none either — the deadline is read only
 * between polls. A remote service that accepts the POST connection but never responds
 * therefore hangs before the loop is ever entered, so the overall deadline never fires
 * and the call stalls indefinitely (OWASP LLM unbounded consumption, S12).
 *
 * Contract these encode: EACH remote fetch (POST and every poll GET)
 * must be bounded by its own AbortSignal/timeout, so a single hung request cannot stall
 * the run past a deterministic window even when the overall deadline check is unreachable.
 * No real network is touched: fetchImpl is an injected stub that captures options and
 * never resolves, and the remote URL is a fixed unreachable placeholder.
 *
 * Each fixture passes once runViaService bounds every individual remote fetch with a
 * signal, instead of relying solely on a between-polls deadline.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { orchestrationRun } from '../../../lib/mcp/tools/orchestration-run.mjs';

// Pin an explicit small per-request timeout so this proof of the per-request bound is
// deterministic regardless of the production default:
// the test must not depend on — nor silently re-manufacture — the client's default value.

const REMOTE_ENV = {
  CONSTRUCT_ORCHESTRATION_URL: 'http://remote.invalid',
  CONSTRUCT_ORCHESTRATION_TOKEN: 'test-token',
  CONSTRUCT_ORCHESTRATION_TIMEOUT_MS: '150',
};

// A fetch that records options and never settles — a remote service that accepts the
// socket but never replies.

function neverResolvingFetch() {
  const calls = [];
  const impl = (url, opts = {}) => {
    calls.push({ url, opts });
    return new Promise(() => {});
  };
  return { impl, calls };
}

// The overall timeout_ms is set generously here so the test exercises the PER-REQUEST
// bound, not the overall deadline. The deterministic margin is far below it: if the call
// has not settled within the margin, the individual POST was unbounded.

const OVERALL_TIMEOUT_MS = 10_000;
const DETERMINISTIC_BOUND_MS = 400;

function settledWithin(promise, ms) {
  return Promise.race([
    promise.then(() => 'settled', () => 'settled'),
    new Promise((resolve) => setTimeout(() => resolve('still-pending'), ms)),
  ]);
}

test('[R20] the initial remote POST is bounded by its own AbortSignal (white-box)', async () => {
  const { impl, calls } = neverResolvingFetch();
  const call = orchestrationRun(
    { request: 'orchestrate remotely', wait: true, timeout_ms: OVERALL_TIMEOUT_MS },
    { env: REMOTE_ENV, cwd: process.cwd(), fetchImpl: impl },
  );
  call.catch(() => {});

  await new Promise((r) => setTimeout(r, 50));

  assert.equal(calls.length, 1, `precondition: the remote POST was issued once. calls=${calls.map((c) => c.url).join(',')}`);
  assert.ok(/\/api\/orchestration\/runs$/.test(calls[0].url), `precondition: first call is the run POST. url=${calls[0].url}`);
  assert.ok(
    'signal' in (calls[0].opts || {}) && calls[0].opts.signal,
    `the initial remote POST carries no AbortSignal; only the between-polls deadline bounds the run, `
      + `and that deadline is never reached while the POST hangs. optsKeys=${Object.keys(calls[0].opts || {}).join(',')}`,
  );
});

test('[R20] a hung remote POST settles within a deterministic per-request bound (black-box)', async () => {
  const { impl } = neverResolvingFetch();
  const call = orchestrationRun(
    { request: 'orchestrate remotely', wait: true, timeout_ms: OVERALL_TIMEOUT_MS },
    { env: REMOTE_ENV, cwd: process.cwd(), fetchImpl: impl },
  );
  call.catch(() => {});

  const outcome = await settledWithin(call, DETERMINISTIC_BOUND_MS);
  assert.equal(
    outcome,
    'settled',
    `remote orchestration was still pending after ${DETERMINISTIC_BOUND_MS}ms (overall timeout_ms=${OVERALL_TIMEOUT_MS}ms) `
      + 'against a never-resolving POST; the per-request fetch is unbounded, so a single hung request stalls the run '
      + 'until the overall deadline — which is only checked inside the poll loop the hung POST never reaches.',
  );
});
