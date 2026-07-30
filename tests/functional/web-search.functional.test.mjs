/**
 * tests/functional/web-search.functional.test.mjs
 *
 * Contract tests for the governed web_search surface. Pins the three
 * invariants from the capability contract: required inputs return a typed INVALID_INPUT error; a
 * missing/unreachable provider returns a typed degradation with zero results (never a faked search,
 * never source/repo results dressed as web results); and every returned result carries a verifiable
 * URL, a claim-relative class, and an Admiralty grade with a derived confidence — results
 * without a URL are dropped. Confidence `high` is reserved for A1/A2/B1.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { webSearch } from '../../lib/mcp/tools/web-search.mjs';

const PROVIDER_ENV = { WEB_SEARCH_URL: 'https://search.example.test/api', WEB_SEARCH_KEY: 'k' };

function fetchReturning(results) {
  return async () => ({ ok: true, json: async () => ({ results }) });
}

test('query and claim are required, returning a typed INVALID_INPUT error', async () => {
  const noQuery = await webSearch({ claim: 'x' }, { env: PROVIDER_ENV, fetchImpl: fetchReturning([]) });
  assert.equal(noQuery.error.code, 'INVALID_INPUT');
  const noClaim = await webSearch({ query: 'x' }, { env: PROVIDER_ENV, fetchImpl: fetchReturning([]) });
  assert.equal(noClaim.error.code, 'INVALID_INPUT');
});

test('no configured provider returns a typed degradation and zero results (never faked)', async () => {
  let fetched = false;
  const res = await webSearch({ query: 'q', claim: 'c' }, { env: {}, fetchImpl: async () => { fetched = true; return { ok: true, json: async () => ({}) }; } });
  assert.equal(res.degraded, true);
  assert.equal(res.degradationReason, 'capability-unavailable');
  assert.deepEqual(res.results, []);
  assert.equal(res.source, 'web', 'a degraded web result is still labeled web, not source/repo');
  assert.equal(fetched, false, 'no provider means no network call');
});

test('an unreachable provider returns server-unreachable, not a partial guess', async () => {
  const httpErr = await webSearch({ query: 'q', claim: 'c' }, { env: PROVIDER_ENV, fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  assert.equal(httpErr.degradationReason, 'server-unreachable');
  const thrown = await webSearch({ query: 'q', claim: 'c' }, { env: PROVIDER_ENV, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(thrown.degradationReason, 'server-unreachable');
  assert.deepEqual(thrown.results, []);
});

test('results without a verifiable URL are dropped; kept results carry url + class + grade', async () => {
  const res = await webSearch({ query: 'q', claim: 'do developers hit friction with X' }, {
    env: PROVIDER_ENV,
    fetchImpl: fetchReturning([
      { url: 'https://example.com/a', title: 'A', snippet: 's' },
      { title: 'no url — must be dropped' },
      { url: 'ftp://nope', title: 'bad scheme' },
      { url: 'https://reddit.com/r/x/comments/1', title: 'community' },
    ]),
  });
  assert.equal(res.degraded, false);
  assert.equal(res.results.length, 2, 'only https results with a URL are kept');
  assert.equal(res.dropped, 2, 'no-url and bad-scheme results are dropped, counted');
  for (const r of res.results) {
    assert.equal(r.source, 'web', 'every result is labeled web (non-conflation)');
    assert.ok(/^https:\/\//.test(r.url), 'kept results carry a verifiable URL');
    assert.ok(['internal', 'primary', 'secondary', 'tertiary'].includes(r.class), 'claim-relative class present');
    assert.ok(/^[A-F][1-6]$/.test(r.admiralty), 'Admiralty grade present');
    assert.ok(['high', 'medium', 'low'].includes(r.confidence), 'derived confidence present');
  }
});

test('community hosts default to tertiary class (conservative until graded)', async () => {
  const res = await webSearch({ query: 'q', claim: 'c' }, {
    env: PROVIDER_ENV,
    fetchImpl: fetchReturning([
      { url: 'https://reddit.com/r/x/1' },
      { url: 'https://docs.python.org/3/' },
    ]),
  });
  const byHost = Object.fromEntries(res.results.map((r) => [new URL(r.url).hostname, r.class]));
  assert.equal(byHost['reddit.com'], 'tertiary');
  assert.equal(byHost['docs.python.org'], 'secondary');
});

test('confidence high is reserved for A1/A2/B1 (ADR-0017 Admiralty mapping)', async () => {
  const res = await webSearch({ query: 'q', claim: 'c' }, {
    env: PROVIDER_ENV,
    fetchImpl: fetchReturning([
      { url: 'https://example.com/strong', admiralty: 'A1' },
      { url: 'https://example.com/mid', admiralty: 'B2' },
      { url: 'https://example.com/weak', admiralty: 'E4' },
      { url: 'https://example.com/ungraded' },
    ]),
  });
  const conf = Object.fromEntries(res.results.map((r) => [r.admiralty + (r.needsGrading ? '*' : ''), r.confidence]));
  assert.equal(conf['A1'], 'high');
  assert.notEqual(conf['B2'], 'high', 'B2 is not high');
  assert.equal(conf['E4'], 'low');
  assert.equal(conf['C3*'], 'low', 'an ungraded result defaults to C3 and needsGrading');
});

test('results carry a normalized date and a 12-month staleness flag', async () => {
  const now = Date.parse('2026-06-30');
  const res = await webSearch({ query: 'q', claim: 'c' }, {
    env: PROVIDER_ENV,
    now,
    fetchImpl: fetchReturning([
      { url: 'https://example.com/fresh', date: '2026-05-01' },
      { url: 'https://example.com/old', publishedAt: '2021-01-01' },
      { url: 'https://example.com/undated' },
    ]),
  });
  const byUrl = Object.fromEntries(res.results.map((r) => [r.url, r]));
  assert.equal(byUrl['https://example.com/fresh'].date, '2026-05-01');
  assert.equal(byUrl['https://example.com/fresh'].stale, false);
  assert.equal(byUrl['https://example.com/old'].date, '2021-01-01');
  assert.equal(byUrl['https://example.com/old'].stale, true, 'older than 12 months is stale');
  assert.equal(byUrl['https://example.com/undated'].date, null);
  assert.equal(byUrl['https://example.com/undated'].stale, false, 'undated is not stale, just dateless');
});

test('results are ordered most-recent-first, not in provider (relevance/authority) order', async () => {
  const now = Date.parse('2026-06-30');
  const res = await webSearch({ query: 'q', claim: 'c' }, {
    env: PROVIDER_ENV,
    now,
    fetchImpl: fetchReturning([
      { url: 'https://example.com/old', date: '2020-01-01', admiralty: 'A1' },
      { url: 'https://example.com/undated' },
      { url: 'https://example.com/newer', date: '2026-03-01', admiralty: 'C3' },
    ]),
  });
  const order = res.results.map((r) => r.url);
  assert.equal(order[0], 'https://example.com/newer', 'a fresh source leads even over an older A1 authority');
  assert.equal(order[order.length - 1], 'https://example.com/old', 'a stale source is demoted to last');
});
