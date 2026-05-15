/**
 * tests/retrieval-bench.test.mjs — retrieval benchmark runner contract.
 *
 * Pins the structured metric output (recall@5, precision@5, MRR, p50/p95
 * latency, empty-rate, fallback-rate), the regression-threshold gating
 * (recall, mrr, latency caps), and the mustNotInclude assertion that
 * catches a known-bad doc reappearing in results after a tuning change.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runRetrievalBench, formatBenchSummary } from '../lib/evals/retrieval-bench.mjs';

function fakeSearch(corpus) {
  return async (query) => {
    const scored = corpus.map((doc) => ({
      id: doc.id,
      score: query.toLowerCase().split(/\W+/).filter(Boolean)
        .reduce((acc, term) => acc + (doc.text.toLowerCase().includes(term) ? 1 : 0), 0),
    })).filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
    return { ids: scored.slice(0, 5).map((s) => s.id), results: scored.slice(0, 5) };
  };
}

const CORPUS = [
  { id: 'docs/adr/auth-flow.md', text: 'login redirect after auth callback authentication flow design' },
  { id: 'docs/prd/login.md', text: 'login product requirements user flow signin' },
  { id: 'docs/runbook/auth.md', text: 'restart the auth service on incident' },
  { id: 'docs/postmortem/payment.md', text: 'payment outage rate limit ratelimit' },
  { id: 'docs/concepts/architecture.md', text: 'overall architecture for the system' },
];

describe('runRetrievalBench', () => {
  it('rejects empty fixture sets', async () => {
    await assert.rejects(() => runRetrievalBench({ fixtures: [], search: fakeSearch(CORPUS) }), /at least one fixture/);
  });

  it('produces the canonical summary fields for a multi-query benchmark', async () => {
    const { summary, perQuery } = await runRetrievalBench({
      fixtures: [
        { name: 'login bug', query: 'login redirect auth callback', expectedIds: ['docs/adr/auth-flow.md'] },
        { name: 'payment outage', query: 'payment outage rate limit', expectedIds: ['docs/postmortem/payment.md'] },
      ],
      search: fakeSearch(CORPUS),
    });
    for (const key of ['recallAt5', 'precisionAt5', 'mrr', 'p50LatencyMs', 'p95LatencyMs', 'emptyRate', 'fallbackRate']) {
      assert.ok(key in summary, `summary missing ${key}`);
    }
    assert.equal(perQuery.length, 2);
    assert.equal(summary.queries, 2);
  });

  it('reports regressions when recall@5 dips below the threshold', async () => {
    const { summary } = await runRetrievalBench({
      fixtures: [
        { name: 'impossible', query: 'this query matches nothing zzzqqq', expectedIds: ['docs/adr/auth-flow.md'] },
      ],
      search: fakeSearch(CORPUS),
      thresholds: { minRecallAt5: 0.5 },
    });
    assert.ok(summary.regressed.some((r) => r.metric === 'recallAt5'));
  });

  it('flags a doc that mustNotInclude appears in results', async () => {
    const { summary } = await runRetrievalBench({
      fixtures: [
        { name: 'auth ban', query: 'auth login', expectedIds: ['docs/adr/auth-flow.md'], mustNotInclude: ['docs/postmortem/payment.md'] },
      ],
      search: async () => ({ ids: ['docs/adr/auth-flow.md', 'docs/postmortem/payment.md'] }),
    });
    assert.ok(summary.regressed.some((r) => r.metric === 'mustNotInclude'));
  });

  it('counts fallback usage and empty-result rate', async () => {
    const { summary } = await runRetrievalBench({
      fixtures: [
        { name: 'q1', query: 'q1', expectedIds: ['a'] },
        { name: 'q2', query: 'q2', expectedIds: ['b'] },
      ],
      search: async (q) => (q === 'q1' ? { ids: [], fallback: true } : { ids: ['b'] }),
    });
    assert.ok(summary.fallbackRate > 0);
    assert.ok(summary.emptyRate > 0);
  });
});

describe('formatBenchSummary', () => {
  it('renders a readable report including regressions', async () => {
    const result = await runRetrievalBench({
      fixtures: [{ name: 'q', query: 'q', expectedIds: ['x'] }],
      search: async () => ({ ids: [] }),
      thresholds: { minRecallAt5: 0.5 },
    });
    const txt = formatBenchSummary(result);
    assert.match(txt, /recall@5/);
    assert.match(txt, /Regressed/);
  });
});
