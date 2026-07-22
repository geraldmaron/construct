/**
 * tests/certification/knowledge-store-matrix.test.mjs — KnowledgeStore certification matrix.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KNOWLEDGE_STORE_MATRIX_ID,
  isKnowledgeStoreMatrixRegistered,
  runKnowledgeStoreMatrix,
} from '../../lib/certification/knowledge-store-matrix.mjs';
import { KNOWLEDGE_STORE_MODES } from '../../lib/engine/knowledge-store-contract.mjs';

test('matrix is registered for construct certify discovery', () => {
  assert.equal(isKnowledgeStoreMatrixRegistered(), true);
  assert.equal(KNOWLEDGE_STORE_MATRIX_ID, 'knowledge-store-matrix');
});

test('local mode reports all four modes explicitly', async () => {
  const report = await runKnowledgeStoreMatrix({ mode: 'local' });
  assert.equal(report.results.length, KNOWLEDGE_STORE_MODES.length);
  for (const mode of KNOWLEDGE_STORE_MODES) {
    const row = report.results.find((entry) => entry.mode === mode);
    assert.ok(row, `missing mode row: ${mode}`);
    assert.ok(['certified', 'skipped', 'failed'].includes(row.status));
    assert.ok(typeof row.detail === 'string' && row.detail.length > 0);
  }
});

test('minimal-local mode exercises keyword search', async () => {
  const report = await runKnowledgeStoreMatrix({ mode: 'local' });
  const minimal = report.results.find((entry) => entry.mode === 'minimal-local');
  assert.equal(minimal.status, 'certified', minimal.detail);
  assert.match(minimal.detail, /hit/i);
});

test('team and remote modes document infra skips when Postgres/remote embedding absent', async () => {
  const report = await runKnowledgeStoreMatrix({
    mode: 'local',
    env: { ...process.env, CONSTRUCT_DATABASE_URL: '', CONSTRUCT_EMBEDDING_MODEL: 'hashing' },
  });
  const team = report.results.find((entry) => entry.mode === 'team');
  const remote = report.results.find((entry) => entry.mode === 'remote-where-justified');
  assert.equal(team.status, 'skipped');
  assert.match(team.detail, /Postgres/i);
  assert.equal(remote.status, 'skipped');
  assert.match(remote.detail, /remote embedding/i);
});
