/**
 * tests/storage-keyword-adapter.test.mjs — unit tests for the no-vector
 * (keyword/BM25) retrieval adapter, lib/storage/adapters/keyword-adapter.mjs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { KeywordRetrievalAdapter } from '../lib/storage/adapters/keyword-adapter.mjs';

let tmpDir;
let env;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-adapter-test-'));
  env = { CONSTRUCT_KEYWORD_INDEX_PATH: path.join(tmpDir, 'keyword-index') };
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('KeywordRetrievalAdapter', () => {
  it('reports healthy unconditionally — no external reachability to fail', async () => {
    const adapter = new KeywordRetrievalAdapter({ env, rootDir: tmpDir });
    assert.equal(await adapter.isHealthy(), true);
    assert.equal(await adapter.isPgvectorEnabled(), false);
  });

  it('hasObservationsTable is false until a row is stored, without provisioning the index dir', async () => {
    const adapter = new KeywordRetrievalAdapter({ env, rootDir: tmpDir });
    assert.equal(await adapter.hasObservationsTable(), false);
    assert.equal(fs.existsSync(env.CONSTRUCT_KEYWORD_INDEX_PATH), false, 'a mere existence check must not materialize the index');
  });

  it('storeObservation + searchObservations rank by BM25 over stored text', async () => {
    const adapter = new KeywordRetrievalAdapter({ env, rootDir: tmpDir });
    await adapter.storeObservation({
      id: 'obs-1',
      project: 'p',
      role: 'engineer',
      category: 'pattern',
      summary: 'Authentication uses JWT tokens',
      content: 'Refresh tokens are stored in httpOnly cookies.',
      tags: ['auth', 'jwt'],
    });
    await adapter.storeObservation({
      id: 'obs-2',
      project: 'p',
      role: 'engineer',
      category: 'pattern',
      summary: 'Caching layer uses Redis',
      content: 'TTL is five minutes for hot keys.',
      tags: ['cache'],
    });

    const results = await adapter.searchObservations({ project: 'p', query: 'JWT authentication tokens', limit: 5 });
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'obs-1');
    assert.deepEqual(results[0].tags, ['auth', 'jwt']);
    assert.ok(results[0].similarity > 0, 'the top hit normalizes to a positive similarity');
  });

  it('filters searchObservations by role, category, and project', async () => {
    const adapter = new KeywordRetrievalAdapter({ env, rootDir: tmpDir });
    await adapter.storeObservation({ id: 'a', project: 'p1', role: 'cx-engineer', category: 'pattern', summary: 'shared token here' });
    await adapter.storeObservation({ id: 'b', project: 'p2', role: 'cx-architect', category: 'decision', summary: 'shared token here' });

    const byRole = await adapter.searchObservations({ query: 'shared token', role: 'cx-engineer' });
    assert.deepEqual(byRole.map((r) => r.id), ['a']);

    const byProject = await adapter.searchObservations({ query: 'shared token', project: 'p2' });
    assert.deepEqual(byProject.map((r) => r.id), ['b']);

    const byCategory = await adapter.searchObservations({ query: 'shared token', category: 'decision' });
    assert.deepEqual(byCategory.map((r) => r.id), ['b']);
  });

  it('storeObservation upserts by id rather than duplicating rows', async () => {
    const adapter = new KeywordRetrievalAdapter({ env, rootDir: tmpDir });
    await adapter.storeObservation({ id: 'obs-1', project: 'p', summary: 'first version' });
    await adapter.storeObservation({ id: 'obs-1', project: 'p', summary: 'second version' });

    const results = await adapter.searchObservations({ project: 'p', query: 'version', limit: 10 });
    assert.equal(results.length, 1);
    assert.equal(results[0].summary, 'second version');
  });

  it('getObservationFingerprints returns contentHash/model for known ids only', async () => {
    const adapter = new KeywordRetrievalAdapter({ env, rootDir: tmpDir });
    await adapter.storeObservation({ id: 'obs-1', project: 'p', summary: 'x', contentHash: 'hash-1', model: 'hashing-bow-v1' });

    const fp = await adapter.getObservationFingerprints(['obs-1', 'obs-missing']);
    assert.equal(fp.size, 1);
    assert.deepEqual(fp.get('obs-1'), { contentHash: 'hash-1', model: 'hashing-bow-v1' });
  });

  it('pruneObservations evicts by maxAgeDays and maxRows', async () => {
    const adapter = new KeywordRetrievalAdapter({ env, rootDir: tmpDir });
    const isoDaysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    for (let i = 0; i < 3; i++) {
      await adapter.storeObservation({ id: `old-${i}`, project: 'p', summary: `old ${i}`, createdAt: isoDaysAgo(100 - i) });
    }
    await adapter.storeObservation({ id: 'recent', project: 'p', summary: 'recent', createdAt: isoDaysAgo(1) });

    const result = await adapter.pruneObservations({ maxAgeDays: 30 });
    assert.equal(result.evictedCount, 3);
    assert.equal(result.remainingCount, 1);
  });

  it('storeDocument + searchDocuments rank by BM25 over stored text', async () => {
    const adapter = new KeywordRetrievalAdapter({ env, rootDir: tmpDir });
    await adapter.storeDocument({ id: 'doc-1', project: 'p', kind: 'context', title: 'Context state', summary: 'auth JWT overview', body: 'details about JWT auth flow' });
    await adapter.storeDocument({ id: 'doc-2', project: 'p', kind: 'context', title: 'Unrelated', summary: 'billing', body: 'details about billing cycles' });

    const results = await adapter.searchDocuments({ project: 'p', query: 'JWT auth', limit: 5 });
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'doc-1');
  });

  it('sizeBytes/exists/reset reflect the on-disk index files', async () => {
    const adapter = new KeywordRetrievalAdapter({ env, rootDir: tmpDir });
    assert.equal(await adapter.exists(), false);
    assert.equal(await adapter.sizeBytes(), 0);

    await adapter.storeObservation({ id: 'obs-1', project: 'p', summary: 'x' });
    assert.equal(await adapter.exists(), true);
    assert.ok((await adapter.sizeBytes()) > 0);

    await adapter.reset();
    assert.equal(await adapter.exists(), false);
    assert.equal(fs.existsSync(env.CONSTRUCT_KEYWORD_INDEX_PATH), false);
  });

  it('searchObservations/searchDocuments return empty for a missing query', async () => {
    const adapter = new KeywordRetrievalAdapter({ env, rootDir: tmpDir });
    assert.deepEqual(await adapter.searchObservations({ project: 'p' }), []);
    assert.deepEqual(await adapter.searchDocuments({ project: 'p' }), []);
  });
});
