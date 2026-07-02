/**
 * tests/audit/f09-orchestration/remote-status-timeout.test.mjs — construct-o6t8.2 proof.
 *
 * The remote orchestration client (lib/mcp/tools/orchestration-run.mjs) bounded the
 * run POST with a hard-coded 200ms per-request timeout and left the status poll GET
 * (statusViaService) completely unbounded — a healthy remote service slower than
 * 200ms was reported as unreachable, and a service that accepted the poll connection
 * but never replied hung the call forever (ORCH-004: every remote fetch must be
 * bounded). openai-python and anthropic-sdk-python both default the overall request
 * timeout to 600000ms; this fix raises Construct's default to 30000ms (env-overridable
 * via CONSTRUCT_ORCHESTRATION_TIMEOUT_MS) and applies the same AbortSignal bound to
 * statusViaService.
 *
 * Three proofs: (1) statusViaService against a never-resolving fetch settles within
 * its own bound, and the error names the bound and says timeout, not unreachable;
 * (2) the resolved production default is generous (>= 30000ms), not 200ms;
 * (3) an explicit CONSTRUCT_ORCHESTRATION_TIMEOUT_MS=0 is honored rather than treated
 * as unset (parse-then-default, not `|| fallback`). No real network is touched:
 * fetchImpl is an injected stub.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { statusViaService, orchestrationStatus, DEFAULT_REQUEST_TIMEOUT_MS } from '../../../lib/mcp/tools/orchestration-run.mjs';

const REMOTE = { base: 'http://remote.invalid', token: 'test-token' };

function neverResolvingFetch() {
  return () => new Promise(() => {});
}

test('[construct-o6t8.2] statusViaService against a never-resolving fetch settles within its bound and names it', async () => {
  const start = Date.now();
  const result = await statusViaService(REMOTE, { run_id: 'run-1' }, { fetchImpl: neverResolvingFetch(), timeoutMs: 300 });

  assert.ok(Date.now() - start < 1000, 'poll GET must settle within its bound, not hang indefinitely');
  assert.ok(/timeout/i.test(result.error), `error text must say timeout. error=${result.error}`);
  assert.ok(!/not reachable/i.test(result.error), `a bounded timeout is not the same failure as unreachable. error=${result.error}`);
  assert.ok(/300ms/.test(result.error), `error text must name the bound. error=${result.error}`);
});

test('[construct-o6t8.2] production default request timeout is generous, not a 200ms reachability probe', () => {
  assert.ok(DEFAULT_REQUEST_TIMEOUT_MS >= 30000, `default request timeout must be >= 30000ms, not 200ms. default=${DEFAULT_REQUEST_TIMEOUT_MS}`);
});

test('[construct-o6t8.2] a healthy remote service that responds in 500ms succeeds against the production default', async () => {
  const fetchImpl = async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { ok: true, status: 200, json: async () => ({ data: { runId: 'run-1', status: 'completed' } }) };
  };

  const result = await orchestrationStatus(
    { run_id: 'run-1' },
    { env: { CONSTRUCT_ORCHESTRATION_URL: REMOTE.base, CONSTRUCT_ORCHESTRATION_TOKEN: REMOTE.token }, fetchImpl },
  );

  assert.equal(result.status, 'completed', `a 500ms-latency healthy service must not be timed out by the default. result=${JSON.stringify(result)}`);
});

test('[construct-o6t8.2] CONSTRUCT_ORCHESTRATION_TIMEOUT_MS=0 is honored, not treated as unset', async () => {
  const start = Date.now();
  const result = await statusViaService(
    REMOTE,
    { run_id: 'run-1' },
    { fetchImpl: neverResolvingFetch(), env: { CONSTRUCT_ORCHESTRATION_TIMEOUT_MS: '0' } },
  );

  assert.ok(Date.now() - start < 500, 'an explicit 0 timeout must abort near-instantly, not fall back to the 30000ms default');
  assert.ok(/timeout/i.test(result.error), `error text must say timeout. error=${result.error}`);
});
