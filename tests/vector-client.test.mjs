/**
 * tests/vector-client.test.mjs — tests for lib/storage/vector-client.mjs
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('VectorClient', () => {
  let VectorClient;
  let client;
  let tmpDir;
  // The table's embedding column is sized to the active engine
  // (CONSTRUCT_EMBEDDING_MODEL: local=384, hashing=256). Size fixtures to the
  // same dimension or the query reports "No vector column found to match the
  // query vector dimension".
  let dim;

  beforeEach(async () => {
    const mod = await import('../lib/storage/vector-client.mjs');
    VectorClient = mod.VectorClient;
    tmpDir = path.join(os.tmpdir(), `construct-vector-test-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    process.env.CONSTRUCT_LANCEDB_PATH = tmpDir;
    dim = await new VectorClient().getEngineDimensions();
  });

  it('isHealthy returns true when lancedb is reachable', async () => {
    client = new VectorClient();
    const result = await client.isHealthy();
    assert.equal(result, true);
  });

  it('storeObservation and searchObservations work with local LanceDB', async () => {
    client = new VectorClient();
    const id = 'test-obs-1';
    const embedding = new Float32Array(dim).fill(0.1);
    
    await client.storeObservation({
      id,
      project: 'test-project',
      role: 'engineer',
      category: 'pattern',
      summary: 'LanceDB is fast',
      content: 'A columnar database for vectors.',
      embedding
    });


    const results = await client.searchObservations({
      project: 'test-project',
      queryEmbedding: embedding,
      limit: 1
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].id, id);
    assert.ok(results[0].similarity > 0.9);
  });

  it('storeDocument and searchDocuments work with local LanceDB', async () => {
    client = new VectorClient();
    const id = 'test-doc-1';
    const embedding = new Float32Array(dim).fill(0.2);
    
    await client.storeDocument({
      id,
      project: 'test-project',
      kind: 'prd',
      title: 'New Feature',
      body: 'Details about the feature.',
      embedding
    });

    const results = await client.searchDocuments({
      project: 'test-project',
      queryEmbedding: embedding,
      limit: 1
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].id, id);
    assert.ok(results[0].similarity > 0.9);
  });

  it('serializes concurrent writes so every one persists and is searchable', async () => {
    const N = 12;
    await Promise.all(Array.from({ length: N }, (_, i) => {
      const c = new VectorClient();
      return c.storeObservation({
        id: `cobs-${i}`,
        project: 'test-project',
        role: 'engineer',
        category: 'pattern',
        summary: `concurrent ${i}`,
        content: 'body',
        embedding: new Float32Array(dim).fill(0.1 + i * 0.001),
      }).then(() => c.close());
    }));

    const reader = new VectorClient();
    const results = await reader.searchObservations({
      project: 'test-project',
      queryEmbedding: new Float32Array(dim).fill(0.15),
      limit: 50,
    });
    assert.equal(results.length, N, `all ${N} concurrent writes must persist (LanceDB write serialization)`);
  });
});
