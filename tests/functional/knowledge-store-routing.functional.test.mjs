/**
 * tests/functional/knowledge-store-routing.functional.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { resolveKnowledgeStoreSelection } from '../../lib/engine/knowledge-store-contract.mjs';
import { buildHybridSearchResultsAsync } from '../../lib/storage/hybrid-query.mjs';
import { _resetAutoFallbackWarningForTests } from '../../lib/storage/retrieval-adapter.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-routing-'));
  _resetAutoFallbackWarningForTests();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('LanceDB-present: shared selection resolves capable-local-semantic', async () => {
  const env = {
    CONSTRUCT_LANCEDB_PATH: path.join(tmpDir, 'lancedb'),
    CONSTRUCT_EMBEDDING_MODEL: 'local',
  };
  const selection = await resolveKnowledgeStoreSelection({ env, rootDir: tmpDir });
  assert.equal(selection.mode, 'capable-local-semantic');
  assert.equal(selection.adapterMode, 'lancedb');
});

test('LanceDB-absent: hybrid-query degrades to minimal-local without throwing', async () => {
  const env = {
    CONSTRUCT_RETRIEVAL_ADAPTER: 'keyword',
    CONSTRUCT_KEYWORD_INDEX_PATH: path.join(tmpDir, 'keyword-index'),
  };
  const selection = await resolveKnowledgeStoreSelection({ env, rootDir: tmpDir });
  assert.equal(selection.mode, 'minimal-local');

  const results = await buildHybridSearchResultsAsync(tmpDir, 'construct architecture', { env, limit: 3 });
  assert.ok(Array.isArray(results));
});

test('rag retrieve resolves shared selection without throwing in keyword mode', async () => {
  const { retrieve, buildCorpus } = await import('../../lib/knowledge/rag.mjs');
  const env = {
    CONSTRUCT_RETRIEVAL_ADAPTER: 'keyword',
    CONSTRUCT_KEYWORD_INDEX_PATH: path.join(tmpDir, 'keyword-index'),
  };
  const corpus = buildCorpus(tmpDir);
  const chunks = await retrieve('architecture', corpus, { rootDir: tmpDir, env });
  assert.ok(Array.isArray(chunks));
});
