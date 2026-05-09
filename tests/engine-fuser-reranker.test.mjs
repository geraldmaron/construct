/**
 * tests/engine-fuser-reranker.test.mjs — tests for the RRF Fuser and MMR
 * Reranker plugins that replace the legacy weighted-sum fusion in
 * lib/knowledge/rag.mjs.
 *
 * Asserts:
 *   - RRF score = Σ 1/(k+rank) and items present in multiple rankers rank
 *     higher than items present in only one.
 *   - RRF tolerates absent documents in some lists without dropping them.
 *   - MMR drops near-duplicates while preserving the highest-relevance item.
 *   - MMR with λ=1.0 reduces to pure relevance ordering.
 *   - MMR with λ=0.0 prefers maximum diversity.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { create as createRrf } from '../lib/engine/fuser-rrf.mjs';
import { create as createMmr } from '../lib/engine/reranker-mmr.mjs';

describe('RRF fuser', () => {
  it('items present in both rankers rank higher than items in one', () => {
    const fuser = createRrf();
    const fused = fuser.fuse({
      bm25: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      cosine: [{ id: 'a' }, { id: 'd' }, { id: 'b' }],
    });
    assert.equal(fused[0].id, 'a', 'a is in both rankers at top — should be #1');
    const aScore = fused.find((f) => f.id === 'a').score;
    const cScore = fused.find((f) => f.id === 'c').score;
    assert.ok(aScore > cScore);
  });

  it('uses the configured k constant', () => {
    const small = createRrf({ k: 1 });
    const large = createRrf({ k: 1000 });
    const lists = { bm25: [{ id: 'a' }, { id: 'b' }] };
    const fSmall = small.fuse(lists)[0].score;
    const fLarge = large.fuse(lists)[0].score;
    assert.ok(fSmall > fLarge, 'smaller k → higher RRF score for top-1');
  });

  it('handles missing documents in some lists without throwing', () => {
    const fuser = createRrf();
    const fused = fuser.fuse({
      bm25: [{ id: 'only-bm25' }],
      cosine: [{ id: 'only-cosine' }],
    });
    assert.equal(fused.length, 2);
    assert.equal(fused[0].score, fused[1].score, 'tied at rank 1 in their respective lists');
  });

  it('accepts both array-of-arrays and named-channel inputs', () => {
    const fuser = createRrf();
    const a = fuser.fuse([[{ id: 'x' }, { id: 'y' }], [{ id: 'x' }]]);
    const b = fuser.fuse({ bm25: [{ id: 'x' }, { id: 'y' }], cosine: [{ id: 'x' }] });
    assert.equal(a.length, b.length);
    assert.equal(a[0].id, b[0].id);
  });

  it('preserves doc fields in the output', () => {
    const fuser = createRrf();
    const fused = fuser.fuse({ bm25: [{ id: 'a', title: 'Foo', extra: 1 }] });
    assert.equal(fused[0].title, 'Foo');
    assert.equal(fused[0].extra, 1);
  });
});

function emb(values) {
  return Float32Array.from(values);
}

describe('MMR reranker', () => {
  it('drops a near-duplicate in favour of a more diverse candidate', async () => {
    // With λ=0.4, MMR weights diversity slightly more than relevance. The
    // near-duplicate of `top` has near-identical similarity to the already-
    // selected `top`, so its diversity penalty cancels its relevance edge;
    // `partial` covers a different facet of the query and wins.
    const mmr = createMmr({ lambda: 0.4 });
    const queryEmbedding = emb([1, 0, 0]);
    const candidates = [
      { id: 'top', embedding: emb([1, 0, 0]) },
      { id: 'dup-of-top', embedding: emb([0.99, 0.01, 0]) },
      { id: 'partial', embedding: emb([0.5, 1, 0]) },
    ];
    const reranked = await mmr.rerank('q', candidates, { queryEmbedding, topK: 2 });
    assert.equal(reranked.length, 2);
    assert.equal(reranked[0].id, 'top');
    assert.equal(reranked[1].id, 'partial', 'MMR should prefer the diverse partial-match over the near-duplicate');
  });

  it('with lambda=1 reduces to pure relevance ordering', async () => {
    const mmr = createMmr({ lambda: 1.0 });
    const queryEmbedding = emb([1, 0, 0]);
    const candidates = [
      { id: 'a', embedding: emb([0.9, 0.1, 0]) },
      { id: 'b', embedding: emb([1, 0, 0]) },
      { id: 'c', embedding: emb([0.5, 0.5, 0]) },
    ];
    const reranked = await mmr.rerank('q', candidates, { queryEmbedding });
    assert.deepEqual(reranked.map((c) => c.id), ['b', 'a', 'c']);
  });

  it('falls back to text-Jaccard similarity when embeddings are absent', async () => {
    const mmr = createMmr({ lambda: 0.5 });
    const candidates = [
      { id: 'a', score: 0.9, title: 'jwt auth flow', body: 'tokens and sessions' },
      { id: 'b', score: 0.85, title: 'jwt auth flow notes', body: 'tokens and sessions notes' },
      { id: 'c', score: 0.7, title: 'rate limiting', body: 'webhook quotas' },
    ];
    const reranked = await mmr.rerank('q', candidates, { topK: 2 });
    assert.equal(reranked[0].id, 'a');
    assert.equal(reranked[1].id, 'c', 'b is near-duplicate of a; c should win');
  });

  it('returns empty array for empty input', async () => {
    const mmr = createMmr();
    const reranked = await mmr.rerank('q', [], {});
    assert.deepEqual(reranked, []);
  });
});
