/**
 * tests/retrieval-fusion.test.mjs — score fusion contracts.
 *
 * Pins weighted-linear fusion (default weights and overrides), reciprocal
 * rank fusion across mismatched score scales, and the recency half-life
 * decay function applied during hybrid retrieval scoring.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { fuseScores, reciprocalRankFusion, recencyScore, DEFAULT_WEIGHTS } from '../lib/storage/fusion.mjs';

describe('fuseScores', () => {
  it('returns 0 when no components have weight', () => {
    const r = fuseScores({}, DEFAULT_WEIGHTS);
    assert.equal(r.finalScore, 0);
  });

  it('returns 1 when every component is 1 with default weights', () => {
    const r = fuseScores({ vector: 1, lexical: 1, metadata: 1, recency: 1 });
    assert.equal(Math.round(r.finalScore * 100), 100);
  });

  it('applies the plan default weights (vector 0.45, lexical 0.35, …)', () => {
    const r = fuseScores({ vector: 1 });
    assert.equal(r.finalScore.toFixed(2), '0.45');
  });

  it('honors caller-supplied weights', () => {
    const r = fuseScores({ vector: 1, lexical: 0 }, { vector: 1.0, lexical: 0, metadata: 0, recency: 0 });
    assert.equal(r.finalScore, 1);
  });

  it('clamps out-of-range components to [0, 1]', () => {
    const r = fuseScores({ vector: 1.5, lexical: -0.2 });
    assert.equal(r.vector, 1);
    assert.equal(r.lexical, 0);
  });

  it('returns component scores so callers can debug retrieval drift', () => {
    const r = fuseScores({ vector: 0.8, lexical: 0.5 });
    assert.equal(r.vector, 0.8);
    assert.equal(r.lexical, 0.5);
    assert.ok(r.weights, 'weights echoed for traceability');
  });
});

describe('reciprocalRankFusion', () => {
  it('returns empty for empty input', () => {
    assert.deepEqual(reciprocalRankFusion([]), []);
  });

  it('ranks docs that appear in more lists higher', () => {
    const a = [{ id: 'x' }, { id: 'y' }];
    const b = [{ id: 'y' }, { id: 'z' }];
    const c = [{ id: 'y' }, { id: 'w' }];
    const fused = reciprocalRankFusion([a, b, c]);
    assert.equal(fused[0].id, 'y');
    assert.equal(fused[0].appearsIn, 3);
  });

  it('is robust to mismatched score scales — uses ranks not scores', () => {
    const bm25 = [{ id: 'A', score: 22.3 }, { id: 'B', score: 14.0 }];
    const cosine = [{ id: 'B', score: 0.91 }, { id: 'A', score: 0.05 }];
    const fused = reciprocalRankFusion([bm25, cosine]);
    const ids = fused.map((f) => f.id).sort();
    assert.deepEqual(ids, ['A', 'B']);
  });

  it('honors the k hyperparameter for the 1/(k+rank) denominator', () => {
    const list = [{ id: 'A' }, { id: 'B' }];
    const lowK = reciprocalRankFusion([list], { k: 5 });
    const highK = reciprocalRankFusion([list], { k: 500 });
    assert.ok(lowK[0].rrfScore > highK[0].rrfScore);
  });
});

describe('recencyScore', () => {
  it('returns ~1 for a doc updated today', () => {
    const score = recencyScore(new Date().toISOString());
    assert.ok(score > 0.95);
  });

  it('returns ~0.5 at one half-life', () => {
    const now = Date.now();
    const halfLifeDays = 30;
    const past = now - halfLifeDays * 24 * 60 * 60 * 1000;
    const score = recencyScore(new Date(past).toISOString(), { halfLifeDays, now });
    assert.ok(Math.abs(score - 0.5) < 0.01);
  });

  it('returns 0 for invalid timestamps', () => {
    assert.equal(recencyScore(null), 0);
    assert.equal(recencyScore('not-a-date'), 0);
  });
});
