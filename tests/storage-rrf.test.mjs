/**
 * tests/storage-rrf.test.mjs — Reciprocal Rank Fusion: rank-only fusion that is
 * agnostic to incompatible score scales, boosts cross-list agreement, and is
 * deterministic.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { reciprocalRankFusion } from '../lib/storage/rrf.mjs';

test('a single list preserves order with score 1/(k+rank)', () => {
  const out = reciprocalRankFusion([[{ id: 'a' }, { id: 'b' }]], { k: 60 });
  assert.deepEqual(out.map((r) => r.id), ['a', 'b']);
  assert.ok(Math.abs(out[0].score - 1 / 61) < 1e-12);
  assert.ok(Math.abs(out[1].score - 1 / 62) < 1e-12);
});

test('a document ranked by both lists beats one ranked by only one', () => {
  const bm25 = [{ id: 'x' }, { id: 'shared' }];
  const vector = [{ id: 'shared' }, { id: 'y' }];
  const out = reciprocalRankFusion([bm25, vector], { k: 60 });
  // shared: 1/62 + 1/61; x: 1/61; y: 1/62 — agreement wins.
  assert.equal(out[0].id, 'shared');
});

test('fusion is by rank, not raw score — incompatible scales do not matter', () => {
  // BM25-like huge scores vs cosine-like tiny scores; only the ORDER is used.
  const bm25 = [{ id: 'a', s: 9999 }, { id: 'b', s: 12 }];
  const vector = [{ id: 'b', s: 0.91 }, { id: 'a', s: 0.40 }];
  const out = reciprocalRankFusion([bm25, vector], { k: 60 });
  // a: 1/61 + 1/62; b: 1/62 + 1/61 — identical fused scores; stable tie-break by id.
  assert.deepEqual(out.map((r) => r.id), ['a', 'b']);
  assert.ok(Math.abs(out[0].score - out[1].score) < 1e-12);
});

test('limit truncates the fused ranking', () => {
  const out = reciprocalRankFusion([[{ id: 'a' }, { id: 'b' }, { id: 'c' }]], { limit: 2 });
  assert.equal(out.length, 2);
});

test('custom idOf and empty/!array lists are handled', () => {
  const out = reciprocalRankFusion(
    [[{ key: 'a' }], null, [], [{ key: 'a' }, { key: 'b' }]],
    { idOf: (x) => x.key },
  );
  assert.equal(out[0].id, 'a');
  assert.equal(out.length, 2);
});

test('rejects a non-positive k', () => {
  assert.throws(() => reciprocalRankFusion([[{ id: 'a' }]], { k: 0 }), /positive number/);
});
