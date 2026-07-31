/**
 * tests/perf/hook-budgets.test.mjs — nightly gate for per-hook p95 budgets.
 *
 * Two-layer enforcement:
 *
 *   1. Header-presence test runs at unit-test speed. Every wired
 *      `lib/hooks/*.mjs` (carrying `@lifecycle`) must declare a `@p95ms`
 *      budget in its file header. A missing header fails the test even
 *      before the harness runs — a new hook cannot land without a budget.
 *
 *   2. The benchmark gate is opt-in via `CONSTRUCT_BENCH_HOOKS=1`. When
 *      enabled, the harness runs and any hook whose measured p95 exceeds
 *      its declared budget × tolerance (default 2×) fails
 *      the test. CI wires this lane via the scheduled job, not per-PR —
 *      hook benchmarking is variance-heavy and would teach the team to
 *      ignore red builds if every PR ran it.
 *
 * Run locally:
 *   node --test tests/perf/hook-budgets.test.mjs                # headers only
 *   CONSTRUCT_BENCH_HOOKS=1 node --test tests/perf/hook-budgets.test.mjs   # + bench
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { main as runBench, parseHeader } from '../../scripts/bench-hooks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const HOOKS_DIR = path.join(ROOT, 'lib', 'hooks');

function listHooks() {
  return readdirSync(HOOKS_DIR)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => path.join(HOOKS_DIR, f));
}

describe('hook headers', () => {
  it('every wired hook declares @p95ms', () => {
    const offenders = [];
    for (const file of listHooks()) {
      const h = parseHeader(file);
      if (h.unwired) continue;
      if (!h.lifecycle) continue;
      if (h.p95ms == null) offenders.push(path.basename(file));
    }
    assert.deepEqual(
      offenders,
      [],
      `Wired hooks missing @p95ms header: ${offenders.join(', ')}`,
    );
  });

  it('declared @p95ms is a finite positive integer', () => {
    const offenders = [];
    for (const file of listHooks()) {
      const h = parseHeader(file);
      if (h.unwired || !h.lifecycle || h.p95ms == null) continue;
      if (!Number.isFinite(h.p95ms) || h.p95ms <= 0 || !Number.isInteger(h.p95ms)) {
        offenders.push(`${path.basename(file)}=${h.p95ms}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `Invalid @p95ms values: ${offenders.join(', ')}`,
    );
  });
});

describe('hook budgets', () => {
  it('measured p95 within tolerance × declared budget (nightly only)', { timeout: 600_000 }, async (t) => {
    if (process.env.CONSTRUCT_BENCH_HOOKS !== '1') {
      t.skip('CONSTRUCT_BENCH_HOOKS=1 not set; skipping benchmark lane');
      return;
    }
    const report = await runBench();
    const failed = report.results
      .filter((r) => r.status === 'fail')
      .map((r) => `${r.name} (lifecycle=${r.lifecycle}, p95=${r.p95Ms}ms, budget=${r.budgetMs}ms × ${report.tolerance})`);
    assert.deepEqual(
      failed,
      [],
      `Hooks over budget: ${failed.join('; ')}`,
    );
  });
});
