/**
 * lib/evals/retrieval-bench.mjs — retrieval benchmark runner with structured metrics.
 *
 * Drives a retrieval function against a set of fixture queries with
 * expected document ids, then summarizes recall@K, precision@K, MRR,
 * latency p50/p95, fallback usage, and empty-result rate. Designed to
 * gate CI on retrieval regressions: pass a stable fixture set, fail
 * the run when any metric drops below threshold.
 *
 * Fixture shape:
 *   {
 *     name, query, expectedIds: string[], filters?: object,
 *     k?: number, mustNotInclude?: string[]
 *   }
 *
 * Result shape:
 *   {
 *     summary: { recallAt5, precisionAt5, mrr, p50LatencyMs, p95LatencyMs,
 *                emptyRate, fallbackRate, queries: N, passed: N, regressed: [...] },
 *     perQuery: [{ name, recall, precision, reciprocalRank, latencyMs, fallback }]
 *   }
 */

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function uniq(values) {
  return [...new Set(values)];
}

function recallForQuery(actualIds, expectedIds) {
  if (expectedIds.length === 0) return 1;
  const hit = expectedIds.filter((id) => actualIds.includes(id)).length;
  return hit / expectedIds.length;
}

function precisionForQuery(actualIds, expectedIds) {
  if (actualIds.length === 0) return 0;
  const hit = actualIds.filter((id) => expectedIds.includes(id)).length;
  return hit / actualIds.length;
}

function mrrForQuery(actualIds, expectedIds) {
  for (let i = 0; i < actualIds.length; i++) {
    if (expectedIds.includes(actualIds[i])) return 1 / (i + 1);
  }
  return 0;
}

/**
 * Run a benchmark suite.
 *
 * @param {object} opts
 * @param {Array} opts.fixtures
 * @param {Function} opts.search — async (query, options) → { ids, fallback?, results? }
 * @param {object} [opts.thresholds] — optional regression gates
 * @returns {Promise<{summary, perQuery}>}
 */
export async function runRetrievalBench({ fixtures, search, thresholds = {} } = {}) {
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    throw new Error('runRetrievalBench: at least one fixture is required');
  }
  if (typeof search !== 'function') {
    throw new Error('runRetrievalBench: search function is required');
  }

  const perQuery = [];
  const latencies = [];
  let emptyCount = 0;
  let fallbackCount = 0;

  for (const fixture of fixtures) {
    const k = fixture.k || 5;
    const started = Date.now();
    const response = await search(fixture.query, { filters: fixture.filters, k });
    const latency = Date.now() - started;
    latencies.push(latency);

    const ids = uniq(response.ids || (response.results || []).map((r) => r.id || r.source_path || r.path)).slice(0, k);
    const fallback = Boolean(response.fallback);
    if (fallback) fallbackCount += 1;
    if (ids.length === 0) emptyCount += 1;

    const recall = recallForQuery(ids, fixture.expectedIds || []);
    const precision = precisionForQuery(ids, fixture.expectedIds || []);
    const reciprocalRank = mrrForQuery(ids, fixture.expectedIds || []);
    const mustNotMatched = (fixture.mustNotInclude || []).some((id) => ids.includes(id));

    perQuery.push({
      name: fixture.name || fixture.query.slice(0, 40),
      recall,
      precision,
      reciprocalRank,
      latencyMs: latency,
      fallback,
      mustNotMatched,
      returnedIds: ids,
    });
  }

  const n = perQuery.length;
  const avg = (selector) => perQuery.reduce((acc, q) => acc + selector(q), 0) / n;
  const summary = {
    queries: n,
    recallAt5: avg((q) => q.recall),
    precisionAt5: avg((q) => q.precision),
    mrr: avg((q) => q.reciprocalRank),
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    emptyRate: emptyCount / n,
    fallbackRate: fallbackCount / n,
    regressed: [],
  };

  if (thresholds.minRecallAt5 !== undefined && summary.recallAt5 < thresholds.minRecallAt5) {
    summary.regressed.push({ metric: 'recallAt5', actual: summary.recallAt5, expected: thresholds.minRecallAt5 });
  }
  if (thresholds.minMrr !== undefined && summary.mrr < thresholds.minMrr) {
    summary.regressed.push({ metric: 'mrr', actual: summary.mrr, expected: thresholds.minMrr });
  }
  if (thresholds.maxP95LatencyMs !== undefined && summary.p95LatencyMs > thresholds.maxP95LatencyMs) {
    summary.regressed.push({ metric: 'p95LatencyMs', actual: summary.p95LatencyMs, expected: thresholds.maxP95LatencyMs });
  }
  if (perQuery.some((q) => q.mustNotMatched)) {
    summary.regressed.push({ metric: 'mustNotInclude', actual: perQuery.filter((q) => q.mustNotMatched).map((q) => q.name) });
  }

  summary.passed = n - summary.regressed.length;

  return { summary, perQuery };
}

export function formatBenchSummary({ summary, perQuery }) {
  const lines = [];
  lines.push(`Retrieval benchmark — ${summary.queries} queries`);
  lines.push(`  recall@5     ${summary.recallAt5.toFixed(3)}`);
  lines.push(`  precision@5  ${summary.precisionAt5.toFixed(3)}`);
  lines.push(`  MRR          ${summary.mrr.toFixed(3)}`);
  lines.push(`  p50 latency  ${summary.p50LatencyMs}ms`);
  lines.push(`  p95 latency  ${summary.p95LatencyMs}ms`);
  lines.push(`  empty rate   ${(summary.emptyRate * 100).toFixed(1)}%`);
  lines.push(`  fallback     ${(summary.fallbackRate * 100).toFixed(1)}%`);
  if (summary.regressed.length > 0) {
    lines.push('  Regressed:');
    for (const r of summary.regressed) lines.push(`    - ${r.metric}: ${JSON.stringify(r.actual)} (expected ${JSON.stringify(r.expected)})`);
  }
  if (perQuery && perQuery.length > 0) {
    lines.push('');
    lines.push('Per query:');
    for (const q of perQuery) {
      lines.push(`  ${q.name.padEnd(40)} recall=${q.recall.toFixed(2)} mrr=${q.reciprocalRank.toFixed(2)} ${q.latencyMs}ms${q.fallback ? ' [fallback]' : ''}`);
    }
  }
  return lines.join('\n');
}
