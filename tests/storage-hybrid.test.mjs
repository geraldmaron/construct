/**
 * tests/storage-hybrid.test.mjs — hybrid storage layer unit and integration tests
 *
 * Tests the hybrid storage backend: file-state snapshots, vector search ranking,
 * hybrid search result merging, SQL-backed result paths, and storage mode descriptors.
 * Verifies product intelligence indexing and sql/vector readiness reporting.
 * Run via npm test.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildHybridSearchResults, buildHybridSearchResultsAsync } from '../lib/storage/hybrid-query.mjs';
import { describeSqlStore, describeSqlStore as describeSql } from '../lib/storage/sql-store.mjs';
import { describeVectorStore, readLocalVectorIndex, vectorSearchLocal } from '../lib/storage/vector-store.mjs';
import { loadStateSnapshot, summarizeStateSnapshot } from '../lib/storage/state-source.mjs';
import { syncFileStateToSql } from '../lib/storage/sync.mjs';
import { deleteIngestedArtifacts, getStorageStatus, resetStorage } from '../lib/storage/admin.mjs';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

test('state snapshot loads file-state artifacts', () => {
  const root = tempDir('construct-hybrid-state-');
  writeJson(path.join(root, '.cx', 'context.json'), { contextSummary: 'shared memory', savedAt: '2026-04-19T00:00:00Z' });
  writeText(path.join(root, 'plan.md'), '# Plan\n\n- Keep hybrid search grounded in docs.\n');
  writeText(path.join(root, 'docs', 'architecture.md'), '# Hybrid\n');
  writeText(path.join(root, 'docs', 'README.md'), '# Docs\n');
  writeText(path.join(root, '.cx', 'knowledge', 'reference', 'evidence-briefs', 'api-evidence.md'), '# Evidence Brief\nPlatform customers need API migration controls.\n');
  writeText(path.join(root, 'docs', 'prd', 'api-migration.md'), '# PRD\nAPI migration controls for platform admins.\n');
  writeText(path.join(root, 'docs', 'meta-prd', 'eval-loop.md'), '# Meta PRD\nAgent evaluation loop requirements.\n');

  const snapshot = loadStateSnapshot(root);
  const summary = summarizeStateSnapshot(snapshot);

  assert.equal(summary.contextSummary, 'shared memory');
  assert.equal(summary.hasPlan, true);
  assert.equal(summary.hasArchitectureDoc, true);
  assert.equal(summary.hasDocsReadme, true);
  assert.equal(summary.productIntelDocCount, 3);
});

test('state snapshot indexes extractable non-markdown product intelligence files', () => {
  const root = tempDir('construct-hybrid-doc-state-');
  writeJson(path.join(root, '.cx', 'context.json'), { contextSummary: 'shared memory', savedAt: '2026-04-19T00:00:00Z' });
  writeText(path.join(root, 'docs', 'prd', 'service-metrics.csv'), 'service,availability\napi,99.95\nworker,99.90\n');

  const snapshot = loadStateSnapshot(root);

  assert.equal(snapshot.productIntelDocs.length, 1);
  assert.equal(snapshot.productIntelDocs[0].path, 'docs/prd/service-metrics.csv');
  assert.match(snapshot.productIntelDocs[0].body, /service,availability/);
});

test('vector search ranks semantic matches from local records', () => {
  const results = vectorSearchLocal([
    { id: 'a', title: 'Workflow alignment', summary: 'status and workflow parity', body: 'publicHealth contract', tags: ['workflow'] },
    { id: 'b', title: 'Unrelated note', summary: 'shopping list', body: 'groceries', tags: ['misc'] },
  ], 'workflow parity', { limit: 5 });

  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'a');
  assert.ok(results[0].score > 0);
});

test('hybrid search returns file-backed results and store modes', () => {
  const root = tempDir('construct-hybrid-query-');
  writeJson(path.join(root, '.cx', 'context.json'), { contextSummary: 'Searchable context for traces', savedAt: '2026-04-19T00:00:00Z' });
  writeText(path.join(root, 'plan.md'), '# Plan\n\n- Search should stay file-state authoritative.\n');
  writeText(path.join(root, 'docs', 'architecture.md'), '# Searchable architecture\nThe hybrid model keeps file-state authoritative.\n');
  writeText(path.join(root, 'docs', 'README.md'), '# Docs\n');
  writeText(path.join(root, '.cx', 'knowledge', 'reference', 'evidence-briefs', 'api-evidence.md'), '# Evidence Brief\nPlatform customers need API migration controls.\n');

  const result = buildHybridSearchResults(root, 'authoritative file-state', {
    limit: 5,
    env: {
      DATABASE_URL: 'postgres://user:pass@localhost:5432/construct',
      CONSTRUCT_VECTOR_URL: 'http://vector.local',
    },
  });

  assert.equal(result.summary.hasPlan, true);
  assert.equal(result.stores.sql.mode, 'postgres');
  assert.equal(result.stores.vector.mode, 'remote');
  assert.ok(result.results.length > 0);
  assert.equal(result.results[0].id, 'docs/architecture.md');
});

test('hybrid search indexes knowledge artifacts', () => {
  const root = tempDir('construct-knowledge-query-');
  writeJson(path.join(root, '.cx', 'context.json'), { contextSummary: 'Product intelligence context', savedAt: '2026-04-20T00:00:00Z' });
  writeText(path.join(root, '.cx', 'knowledge', 'reference', 'evidence-briefs', 'api-evidence.md'), '# Evidence Brief\nPlatform customers need migration controls for API compatibility.\n');
  writeText(path.join(root, 'docs', 'prd', 'api-migration.md'), '# PRD\nAPI migration controls for platform administrators.\n');
  writeText(path.join(root, 'docs', 'meta-prd', 'agent-evals.md'), '# Meta PRD\nAgent evaluation loop and promotion gates.\n');

  const result = buildHybridSearchResults(root, 'platform API migration', { limit: 10 });
  const ids = result.results.map((entry) => entry.id);

  assert.ok(ids.includes('.cx/knowledge/reference/evidence-briefs/api-evidence.md'));
  assert.ok(ids.includes('docs/prd/api-migration.md'));
});

test('async hybrid search merges sql-backed results when configured', async () => {
  const root = tempDir('construct-hybrid-query-sql-');
  writeJson(path.join(root, '.cx', 'context.json'), { contextSummary: 'Searchable context for traces', savedAt: '2026-04-19T00:00:00Z' });
  writeText(path.join(root, 'plan.md'), '# Plan\n\n- Async hybrid search should honor the same state summary.\n');
  writeText(path.join(root, 'docs', 'architecture.md'), '# Searchable architecture\nThe hybrid model keeps file-state authoritative.\n');
  writeText(path.join(root, 'docs', 'README.md'), '# Docs\n');

  const result = await buildHybridSearchResultsAsync(root, 'authoritative file-state', {
    limit: 5,
    env: {
      DATABASE_URL: 'postgres://user:pass@localhost:5432/construct',
      CONSTRUCT_VECTOR_URL: 'http://vector.local',
    },
  });

  assert.equal(result.stores.sql.mode, 'postgres');
  assert.ok(result.results.length > 0);
});

test('storage sync writes local vector index records when configured', async () => {
  const root = tempDir('construct-local-vector-sync-');
  const indexPath = path.join(root, '.construct', 'vector', 'index.json');
  writeJson(path.join(root, '.cx', 'context.json'), { contextSummary: 'Local vector context', savedAt: '2026-04-19T00:00:00Z' });
  writeText(path.join(root, 'docs', 'architecture.md'), '# Searchable architecture\nHybrid local vector path.\n');
  writeText(path.join(root, 'docs', 'prd', 'api-migration.md'), '# PRD\nAPI migration controls for platform administrators.\n');

  const result = await syncFileStateToSql(root, {
    env: {
      CONSTRUCT_VECTOR_INDEX_PATH: indexPath,
      CONSTRUCT_VECTOR_MODEL: 'hashing-bow-v1',
    },
    project: 'local-vector-test',
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.localVector.status, 'ok');
  assert.equal(fs.existsSync(indexPath), true);

  const index = readLocalVectorIndex(indexPath);
  assert.equal(index.model, 'hashing-bow-v1');
  assert.ok(index.records.length >= 2);
  assert.ok(index.records.some((record) => record.id === 'local-vector-test:docs/prd/api-migration.md'));
});

test('hybrid search consumes local vector index records when configured', async () => {
  const root = tempDir('construct-local-vector-query-');
  const indexPath = path.join(root, '.construct', 'vector', 'index.json');
  writeJson(path.join(root, '.cx', 'context.json'), { contextSummary: 'Local vector context', savedAt: '2026-04-19T00:00:00Z' });
  writeText(path.join(root, 'docs', 'prd', 'api-migration.md'), '# PRD\nAPI migration controls for platform administrators.\n');

  await syncFileStateToSql(root, {
    env: {
      CONSTRUCT_VECTOR_INDEX_PATH: indexPath,
      CONSTRUCT_VECTOR_MODEL: 'hashing-bow-v1',
    },
    project: 'local-vector-search',
  });

  const result = buildHybridSearchResults(root, 'platform administrators migration controls', {
    limit: 10,
    env: {
      CONSTRUCT_VECTOR_INDEX_PATH: indexPath,
      CONSTRUCT_VECTOR_MODEL: 'hashing-bow-v1',
    },
  });

  assert.equal(result.stores.vector.mode, 'local');
  assert.ok(result.results.some((entry) => entry.id === 'local-vector-search:docs/prd/api-migration.md'));
});

test('storage status reports ingested artifact count and local vector records', async () => {
  const root = tempDir('construct-storage-status-');
  const indexPath = path.join(root, '.construct', 'vector', 'index.json');
  writeText(path.join(root, '.cx', 'knowledge', 'internal', 'brief.md'), '# Brief\n\nConverted.\n');
  await syncFileStateToSql(root, {
    env: {
      CONSTRUCT_VECTOR_INDEX_PATH: indexPath,
      CONSTRUCT_VECTOR_MODEL: 'hashing-bow-v1',
    },
    project: 'status-project',
  });

  const status = await getStorageStatus(root, {
    env: {
      CONSTRUCT_VECTOR_INDEX_PATH: indexPath,
      CONSTRUCT_VECTOR_MODEL: 'hashing-bow-v1',
    },
    project: 'status-project',
  });

  assert.equal(status.ingested.count, 1);
  assert.equal(status.localVector.recordCount >= 0, true);
});

test('storage reset requires explicit confirmation and clears local vector and ingested artifacts', async () => {
  const root = tempDir('construct-storage-reset-');
  const indexPath = path.join(root, '.construct', 'vector', 'index.json');
  writeText(path.join(root, '.cx', 'knowledge', 'internal', 'brief.md'), '# Brief\n\nConverted.\n');
  await syncFileStateToSql(root, {
    env: {
      CONSTRUCT_VECTOR_INDEX_PATH: indexPath,
      CONSTRUCT_VECTOR_MODEL: 'hashing-bow-v1',
    },
    project: 'reset-project',
  });

  await assert.rejects(
    () => resetStorage(root, {
      env: {
        CONSTRUCT_VECTOR_INDEX_PATH: indexPath,
        CONSTRUCT_VECTOR_MODEL: 'hashing-bow-v1',
      },
      project: 'reset-project',
      resetSql: false,
      resetVector: true,
      resetIngested: true,
    }),
    /requires explicit confirmation/,
  );

  const result = await resetStorage(root, {
    env: {
      CONSTRUCT_VECTOR_INDEX_PATH: indexPath,
      CONSTRUCT_VECTOR_MODEL: 'hashing-bow-v1',
    },
    project: 'reset-project',
    resetSql: false,
    resetVector: true,
    resetIngested: true,
    confirm: true,
  });

  assert.equal(result.localVector.status, 'ok');
  assert.equal(result.ingested.deletedCount, 1);
  assert.equal(readLocalVectorIndex(indexPath).records.length, 0);
});

test('deleteIngestedArtifacts requires confirmation and rejects out-of-scope paths', () => {
  const root = tempDir('construct-delete-ingested-');
  writeText(path.join(root, '.cx', 'knowledge', 'internal', 'brief.md'), '# Brief\n\nConverted.\n');

  assert.throws(
    () => deleteIngestedArtifacts(root, {}),
    /requires explicit confirmation/,
  );

  assert.throws(
    () => deleteIngestedArtifacts(root, { files: ['../outside.md'], confirm: true }),
    /only allows files inside/,
  );

  const result = deleteIngestedArtifacts(root, { confirm: true });
  assert.equal(result.deletedCount, 1);
});

test('sql and vector descriptors reflect fallback and shared-ready modes', () => {
  assert.equal(describeSql({}).mode, 'file');
  assert.equal(describeSqlStore({ DATABASE_URL: 'postgres://example' }).mode, 'postgres');
  assert.equal(describeVectorStore({}).mode, 'file');
  assert.equal(describeVectorStore({ CONSTRUCT_VECTOR_INDEX_PATH: '/tmp/index' }).mode, 'local');
});
