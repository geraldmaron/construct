/**
 * tests/storage/vector-store-recovery.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import {
  VECTOR_STORE_SCHEMA_VERSION,
  backupVectorStore,
  checkVectorStoreHealth,
  evaluateSchemaMigration,
  readVectorStoreMeta,
  restoreVectorStore,
  writeVectorStoreMeta,
} from '../../lib/storage/vector-store-recovery.mjs';

let tmpDir;
let storeDir;
let backupDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-recovery-'));
  storeDir = path.join(tmpDir, 'lancedb');
  backupDir = path.join(tmpDir, 'backup');
  process.env.CONSTRUCT_LANCEDB_PATH = storeDir;
});

afterEach(() => {
  delete process.env.CONSTRUCT_LANCEDB_PATH;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('evaluateSchemaMigration', () => {
  it('returns none when schema matches runtime', () => {
    assert.deepEqual(evaluateSchemaMigration({ schemaVersion: VECTOR_STORE_SCHEMA_VERSION }), { action: 'none' });
  });

  it('returns migrate when store is older than runtime', () => {
    const result = evaluateSchemaMigration({ schemaVersion: 0 });
    assert.equal(result.action, 'migrate');
    assert.equal(result.to, VECTOR_STORE_SCHEMA_VERSION);
  });

  it('returns unsupported when store is newer than runtime', () => {
    const result = evaluateSchemaMigration({ schemaVersion: 99 });
    assert.equal(result.action, 'unsupported');
    assert.equal(result.reason, 'store_schema_newer_than_runtime');
  });
});

describe('checkVectorStoreHealth', () => {
  it('reports corrupted when metadata JSON is invalid', async () => {
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(path.join(storeDir, '.construct-vector-meta.json'), '{not json', 'utf8');
    const health = await checkVectorStoreHealth({ env: process.env, rootDir: tmpDir });
    assert.equal(health.healthy, false);
    assert.equal(health.reason, 'corrupted_metadata');
  });

  it('reports unhealthy when schema is newer than runtime', async () => {
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(
      path.join(storeDir, '.construct-vector-meta.json'),
      `${JSON.stringify({ schemaVersion: 99 })}\n`,
      'utf8',
    );
    const health = await checkVectorStoreHealth({ env: process.env, rootDir: tmpDir });
    assert.equal(health.healthy, false);
    assert.equal(health.reason, 'store_schema_newer_than_runtime');
  });

  it('reports healthy after a populated store round trip', async () => {
    const { VectorClient } = await import('../../lib/storage/vector-client.mjs');
    const client = new VectorClient({ env: process.env });
    const dim = await client.getEngineDimensions();
    await client.storeObservation({
      id: 'recovery-obs-1',
      project: 'test',
      role: 'engineer',
      category: 'pattern',
      summary: 'recovery test',
      content: 'body',
      embedding: new Float32Array(dim).fill(0.2),
    });
    await client.close();
    writeVectorStoreMeta(storeDir);

    const health = await checkVectorStoreHealth({ env: process.env, rootDir: tmpDir });
    assert.equal(health.healthy, true);
  });
});

describe('backupVectorStore / restoreVectorStore', () => {
  it('preserves stored observations across backup and restore', async () => {
    const { VectorClient } = await import('../../lib/storage/vector-client.mjs');
    const client = new VectorClient({ env: process.env });
    const dim = await client.getEngineDimensions();
    const embedding = new Float32Array(dim).fill(0.3);
    await client.storeObservation({
      id: 'backup-obs-1',
      project: 'test',
      role: 'engineer',
      category: 'pattern',
      summary: 'backup me',
      content: 'content',
      embedding,
    });
    await client.close();
    writeVectorStoreMeta(storeDir);

    backupVectorStore({ env: process.env, rootDir: tmpDir, backupPath: backupDir });
    fs.rmSync(storeDir, { recursive: true, force: true });

    restoreVectorStore({ env: process.env, rootDir: tmpDir, backupPath: backupDir });

    const restored = new VectorClient({ env: process.env });
    const results = await restored.searchObservations({
      project: 'test',
      queryEmbedding: embedding,
      limit: 5,
    });
    await restored.close();
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'backup-obs-1');
    assert.ok(readVectorStoreMeta(storeDir).schemaVersion === VECTOR_STORE_SCHEMA_VERSION);
  });
});
