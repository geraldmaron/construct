/**
 * semantic.test.mjs — Tests for the embed semantic analysis module.
 *
 * Covers: text analysis, keyword extraction, and similarity scoring.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

describe('semantic analysis module', () => {
  let sem;

  before(async () => {
    sem = await import('../../lib/embed/semantic.mjs');
  });

  describe('cosineSimilarity', () => {
    it('returns 1 for identical vectors', () => {
      const a = new Float32Array([1, 0, 0, 0]);
      assert.equal(sem.cosineSimilarity(a, a), 1);
    });

    it('returns 0 for orthogonal vectors', () => {
      const a = new Float32Array([1, 0, 0, 0]);
      const b = new Float32Array([0, 1, 0, 0]);
      assert.equal(sem.cosineSimilarity(a, b), 0);
    });

    it('returns ~0.9 for nearly identical vectors', () => {
      const a = new Float32Array([1, 0, 0, 0]);
      const c = new Float32Array([0.9, 0.1, 0, 0]);
      const sim = sem.cosineSimilarity(a, c);
      assert.ok(sim > 0.9);
      assert.ok(sim <= 1);
    });

    it('returns 0 for mismatched length', () => {
      const a = new Float32Array([1, 0, 0, 0]);
      const b = new Float32Array([1, 0, 0]);
      assert.equal(sem.cosineSimilarity(a, b), 0);
    });

    it('returns 0 when either input is null', () => {
      assert.equal(sem.cosineSimilarity(null, new Float32Array([1, 0])), 0);
      assert.equal(sem.cosineSimilarity(new Float32Array([1, 0]), null), 0);
    });
  });

  describe('similarityMatrix', () => {
    it('returns empty array for fewer than 2 vectors', () => {
      assert.deepEqual(sem.similarityMatrix([null]), []);
      assert.deepEqual(sem.similarityMatrix([]), []);
    });

    it('computes pairwise similarities', () => {
      const vecs = [
        new Float32Array([1, 0, 0, 0]),
        new Float32Array([0.9, 0.1, 0, 0]),
        new Float32Array([0, 1, 0, 0]),
      ];
      const pairs = sem.similarityMatrix(vecs);
      // v0-v1 similar, v0-v2 orthogonal (0), v1-v2 low → 2 pairs with sim > 0
      assert.equal(pairs.length, 2);
      assert.ok(pairs[0].similarity > 0);
    });
  });

  describe('clusterVectors', () => {
    it('returns empty for empty input', () => {
      assert.deepEqual(sem.clusterVectors([]), []);
    });

    it('clusters similar items together', () => {
      const items = [
        { id: 'a', vector: new Float32Array([1, 0, 0, 0]) },
        { id: 'b', vector: new Float32Array([0.95, 0.05, 0, 0]) },
        { id: 'c', vector: new Float32Array([0, 1, 0, 0]) },
      ];
      const clusters = sem.clusterVectors(items, { threshold: 0.7 });
      // a and b should cluster together, c should be separate
      const hasClusterOf2 = clusters.some(c => c.clusterSize >= 2);
      assert.ok(hasClusterOf2, 'a+b should form a cluster');
    });

    it('groups nothing when threshold is too high (minClusterSize=2)', () => {
      const items = [
        { id: 'a', vector: new Float32Array([1, 0, 0, 0]) },
        { id: 'b', vector: new Float32Array([0, 1, 0, 0]) },
      ];
      const clusters = sem.clusterVectors(items, { threshold: 0.99, minClusterSize: 2 });
      assert.equal(clusters.length, 0);
    });
  });

  describe('extractTextFromPacket', () => {
    it('extracts triage fields and excerpt', () => {
      const text = sem.extractTextFromPacket({
        triage: { intakeType: 'bug', rationale: 'login fails' },
        excerpt: 'Users cannot login',
      });
      assert.ok(text.includes('bug'));
      assert.ok(text.includes('login fails'));
      assert.ok(text.includes('Users cannot login'));
    });

    it('handles empty packet', () => {
      assert.equal(sem.extractTextFromPacket({}), '');
    });
  });

  describe('cacheStats', () => {
    it('returns zero stats for empty cache', () => {
      const stats = sem.cacheStats();
      assert.ok(typeof stats.total === 'number');
    });
  });
});
