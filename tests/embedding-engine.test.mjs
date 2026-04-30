/**
 * tests/embedding-engine.test.mjs — tests for lib/storage/embeddings-engine.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { embedText, embedBatch, getEmbeddingModelInfo, getAvailableModels } from '../lib/storage/embeddings-engine.mjs';

describe('embeddings-engine', () => {
  it('embedText returns { embedding: Float32Array } with 384 dimensions for local', async () => {
    const result = await embedText('Test embedding for Construct', {
      env: { CONSTRUCT_EMBEDDING_MODEL: 'local' },
    });

    assert.ok(result && typeof result === 'object', 'should return object');
    assert.ok(result.embedding instanceof Float32Array, 'embedding should be Float32Array');
    assert.equal(result.embedding.length, 384, 'local should return 384 dimensions');
    assert.equal(result.dimensions, 384);
  });

  it('embedText accepts local-onnx alias', async () => {
    const result = await embedText('Test embedding', {
      env: { CONSTRUCT_EMBEDDING_MODEL: 'local-onnx' },
    });
    assert.ok(result.embedding instanceof Float32Array);
    assert.equal(result.embedding.length, 384);
  });

  it('embedText returns consistent embeddings for same text', async () => {
    const env = { CONSTRUCT_EMBEDDING_MODEL: 'local' };
    const text = 'Consistent embedding test';
    const a = await embedText(text, { env });
    const b = await embedText(text, { env });

    assert.equal(a.embedding.length, b.embedding.length);
    for (let i = 0; i < a.embedding.length; i++) {
      assert.equal(a.embedding[i], b.embedding[i], 'embeddings should be identical for same text');
    }
  });

  it('embedText handles empty text gracefully', async () => {
    const result = await embedText('', {
      env: { CONSTRUCT_EMBEDDING_MODEL: 'local' },
    });

    assert.ok(result.embedding instanceof Float32Array);
    assert.ok(result.embedding.length > 0, 'should still return valid embedding');
  });

  it('embedBatch returns array of result objects with Float32Array embeddings', async () => {
    const texts = ['First text', 'Second text', 'Third text'];
    const results = await embedBatch(texts, {
      env: { CONSTRUCT_EMBEDDING_MODEL: 'local' },
    });

    assert.ok(Array.isArray(results), 'should return array for batch');
    assert.equal(results.length, 3, 'should return embedding for each text');
    for (const r of results) {
      assert.ok(r.embedding instanceof Float32Array);
      assert.equal(r.embedding.length, 384);
    }
  });

  it('getAvailableModels returns a non-empty array including local', () => {
    const models = getAvailableModels();
    assert.ok(Array.isArray(models));
    assert.ok(models.length > 0, 'should list at least one model');
    assert.ok(models.some(m => m.id === 'local'), 'should include local model');
  });

  it('getEmbeddingModelInfo returns model info object for local', async () => {
    const info = await getEmbeddingModelInfo({
      env: { CONSTRUCT_EMBEDDING_MODEL: 'local' },
    });
    assert.ok(info && typeof info === 'object', 'should return an object');
    assert.ok(info.dimensions > 0, 'dimensions should be positive');
  });
});
