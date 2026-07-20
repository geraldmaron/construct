/**
 * tests/knowledge/knowledge-store-contract.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import {
  KNOWLEDGE_STORE_AXES,
  KNOWLEDGE_STORE_MODES,
  assertKnowledgeStoreCapability,
  checkKnowledgeStoreCapability,
  resolveKnowledgeStoreSelection,
} from '../../lib/engine/knowledge-store-contract.mjs';
import { _resetAutoFallbackWarningForTests } from '../../lib/storage/retrieval-adapter.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-contract-'));
  _resetAutoFallbackWarningForTests();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('resolveKnowledgeStoreSelection', () => {
  it('reports minimal-local when keyword adapter is forced', async () => {
    const selection = await resolveKnowledgeStoreSelection({
      env: { CONSTRUCT_RETRIEVAL_ADAPTER: 'keyword', CONSTRUCT_KEYWORD_INDEX_PATH: path.join(tmpDir, 'idx') },
      rootDir: tmpDir,
    });
    assert.equal(selection.mode, 'minimal-local');
    assert.equal(selection.adapterMode, 'keyword');
    assert.equal(selection.axes.keyword, true);
    assert.equal(selection.axes.vector, false);
  });

  it('reports capable-local-semantic when LanceDB is reachable', async () => {
    const selection = await resolveKnowledgeStoreSelection({
      env: { CONSTRUCT_LANCEDB_PATH: path.join(tmpDir, 'lancedb') },
      rootDir: tmpDir,
    });
    assert.equal(selection.mode, 'capable-local-semantic');
    assert.equal(selection.adapterMode, 'lancedb');
    assert.equal(selection.axes.vector, true);
  });

  it('exports four modes and six axes', () => {
    assert.equal(KNOWLEDGE_STORE_MODES.length, 4);
    assert.equal(KNOWLEDGE_STORE_AXES.length, 6);
  });
});

describe('capability helpers', () => {
  it('assertKnowledgeStoreCapability throws for unavailable vector axis', () => {
    assert.throws(
      () => assertKnowledgeStoreCapability({ mode: 'minimal-local', axes: { vector: false, keyword: true } }, 'vector'),
      /unavailable/,
    );
  });

  it('checkKnowledgeStoreCapability returns false without throwing', () => {
    assert.equal(
      checkKnowledgeStoreCapability({ mode: 'minimal-local', axes: { vector: false, keyword: true } }, 'vector'),
      false,
    );
    assert.equal(
      checkKnowledgeStoreCapability({ mode: 'capable-local-semantic', axes: { vector: true, keyword: true } }, 'vector'),
      true,
    );
  });
});
