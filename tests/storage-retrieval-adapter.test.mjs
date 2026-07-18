/**
 * tests/storage-retrieval-adapter.test.mjs — unit tests for the
 * retrieval-adapter contract/selector, lib/storage/retrieval-adapter.mjs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { resolveAdapterMode, createRetrievalAdapter, _resetAutoFallbackWarningForTests } from '../lib/storage/retrieval-adapter.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retrieval-adapter-test-'));
  _resetAutoFallbackWarningForTests();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('resolveAdapterMode', () => {
  it('defaults to auto when unset', () => {
    assert.equal(resolveAdapterMode({}), 'auto');
  });

  it('recognizes lancedb, keyword, and auto (case/whitespace insensitive)', () => {
    assert.equal(resolveAdapterMode({ CONSTRUCT_RETRIEVAL_ADAPTER: 'LanceDB' }), 'lancedb');
    assert.equal(resolveAdapterMode({ CONSTRUCT_RETRIEVAL_ADAPTER: ' keyword ' }), 'keyword');
    assert.equal(resolveAdapterMode({ CONSTRUCT_RETRIEVAL_ADAPTER: 'auto' }), 'auto');
  });

  it('throws on an unknown mode rather than silently defaulting', () => {
    assert.throws(() => resolveAdapterMode({ CONSTRUCT_RETRIEVAL_ADAPTER: 'pinecone' }), /not a known retrieval adapter/);
  });
});

describe('createRetrievalAdapter', () => {
  it('mode=keyword returns the keyword adapter without attempting a LanceDB load', async () => {
    const adapter = await createRetrievalAdapter({
      env: { CONSTRUCT_RETRIEVAL_ADAPTER: 'keyword', CONSTRUCT_KEYWORD_INDEX_PATH: path.join(tmpDir, 'idx') },
      rootDir: tmpDir,
    });
    assert.equal(adapter.mode, 'keyword');
  });

  it('mode=lancedb returns the LanceDB adapter (installed in this dev environment)', async () => {
    const adapter = await createRetrievalAdapter({
      env: { CONSTRUCT_RETRIEVAL_ADAPTER: 'lancedb', CONSTRUCT_LANCEDB_PATH: path.join(tmpDir, 'lancedb') },
      rootDir: tmpDir,
    });
    assert.equal(adapter.mode, 'lancedb');
  });

  it('mode=auto prefers LanceDB when it is reachable', async () => {
    const adapter = await createRetrievalAdapter({
      env: { CONSTRUCT_LANCEDB_PATH: path.join(tmpDir, 'lancedb') },
      rootDir: tmpDir,
    });
    assert.equal(adapter.mode, 'lancedb');
  });
});
