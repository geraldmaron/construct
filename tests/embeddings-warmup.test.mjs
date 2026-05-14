/**
 * tests/embeddings-warmup.test.mjs — `warmupEmbeddingModel` contract.
 *
 * Setup calls this so the first agent query doesn't stall on a one-time
 * model download. Pins the contract: returns model info + timing, surfaces
 * a degraded flag when the adapter fell through to the hashing fallback,
 * and never throws on adapter errors (best-effort during setup).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { warmupEmbeddingModel } from '../lib/storage/embeddings-engine.mjs';

describe('warmupEmbeddingModel', () => {
  it('returns model + dimensions + timing for the hashing adapter', async () => {
    const result = await warmupEmbeddingModel({ env: { CONSTRUCT_EMBEDDING_MODEL: 'hashing' } });
    assert.equal(result.model, 'hashing-bow-v1');
    assert.equal(result.dimensions, 256);
    assert.equal(typeof result.durationMs, 'number');
    assert.ok(result.durationMs >= 0, 'duration is non-negative');
    assert.ok(!result.degraded, 'hashing adapter is the primary, never degraded');
  });

  it('flags degraded when the local adapter falls through to the hash fallback', async () => {
    // Force the local adapter through its degraded branch without touching ONNX.
    const result = await warmupEmbeddingModel({
      env: { CONSTRUCT_EMBEDDING_MODEL: 'local', CONSTRUCT_EMBEDDING_DISABLE_LOCAL: '1' },
    });
    assert.ok(result.degraded, 'local adapter degraded path sets the flag');
    assert.match(result.fallbackReason || '', /disabled|unavailable/i);
  });
});
