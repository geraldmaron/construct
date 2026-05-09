/**
 * tests/engine-eval-retrieval.test.mjs — retrieval quality regression test.
 *
 * Loads tests/fixtures/retrieval-eval/queries.json, runs it through the
 * engine's retrieval pipeline (BM25 + cosine → RRF fuse → MMR rerank), and
 * asserts the metrics meet a baseline. The baseline is set conservatively
 * — failures here mean the pipeline regressed against a known dataset, not
 * that production retrieval is broken — but it provides a guardrail when
 * swapping plugins.
 *
 * Bumping the baseline: if you intentionally improve retrieval, raise the
 * thresholds here so the new floor sticks.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateFixture, formatReport } from '../lib/engine/eval-retrieval.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'retrieval-eval', 'queries.json');

describe('retrieval quality (BM25 + cosine + RRF + MMR)', () => {
  it('meets the baseline metrics on the fixture query set', async () => {
    const report = await evaluateFixture(FIXTURE);

    // Per-metric guardrails. Baselines reflect the current default pipeline
    // (TF-IDF compressor inactive at retrieve time, RRF k=60, MMR λ=0.7).
    // If any change pushes a metric below its floor, the test fails so the
    // operator can decide whether the regression is intentional.
    assert.ok(
      report.recallAt1 >= 0.6,
      `Recall@1 regressed below floor 0.6. Got ${report.recallAt1.toFixed(3)}\n${formatReport(report)}`
    );
    assert.ok(
      report.recallAt5 >= 0.9,
      `Recall@5 regressed below floor 0.9. Got ${report.recallAt5.toFixed(3)}\n${formatReport(report)}`
    );
    assert.ok(
      report.mrr >= 0.7,
      `MRR regressed below floor 0.7. Got ${report.mrr.toFixed(3)}\n${formatReport(report)}`
    );
    assert.ok(
      report.ndcgAt5 >= 0.7,
      `NDCG@5 regressed below floor 0.7. Got ${report.ndcgAt5.toFixed(3)}\n${formatReport(report)}`
    );
  });

  it('every query has at least one ranked result', async () => {
    const report = await evaluateFixture(FIXTURE);
    for (const q of report.queries) {
      assert.ok(q.ranked.length > 0, `query "${q.query}" produced no ranked results`);
    }
  });

  it('report serialisation includes corpus size and metric headers', async () => {
    const report = await evaluateFixture(FIXTURE);
    const text = formatReport(report);
    assert.match(text, /Corpus:/);
    assert.match(text, /Recall@1:/);
    assert.match(text, /Recall@5:/);
    assert.match(text, /MRR:/);
    assert.match(text, /NDCG@5:/);
  });
});
