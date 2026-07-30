/**
 * tests/storage-admin-status-probe.test.mjs — unit tests for getStorageStatus() health.
 *
 * Verifies that lib/storage/admin.mjs getStorageStatus derives its status from real
 * filesystem state (mirroring probeStorageHealth) rather than the former hardcoded
 * 'healthy'. Uses an injected fsExistsSync stub to avoid touching the real filesystem.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { getStorageStatus } from '../lib/storage/admin.mjs';
import { resolveStateDir } from '../lib/state-root.mjs';

const ROOT = '/fake/project';

// Matches the machine-scoped state root getStorageStatus actually
// resolves the lancedb store against, not a hardcoded `.construct/lancedb`.
const LANCEDB_STATE_PATH = resolveStateDir(ROOT, 'lancedb', { ensureDir: false });

function makeExistsStub({ cx, lancedb }) {
  return (p) => {
    if (p === LANCEDB_STATE_PATH) return lancedb;
    if (p === path.join(ROOT, '.construct')) return cx;
    return false;
  };
}

describe('getStorageStatus health probe', () => {
  it('returns healthy when both .construct/ and .construct/lancedb exist', async () => {
    const status = await getStorageStatus(ROOT, { fsExistsSync: makeExistsStub({ cx: true, lancedb: true }) });
    assert.equal(status.status, 'healthy');
    assert.equal(status.backend, 'lancedb');
  });

  it('returns degraded when .construct/ exists but .construct/lancedb is absent', async () => {
    const status = await getStorageStatus(ROOT, { fsExistsSync: makeExistsStub({ cx: true, lancedb: false }) });
    assert.equal(status.status, 'degraded');
  });

  it('returns unavailable when .construct/ is absent', async () => {
    const status = await getStorageStatus(ROOT, { fsExistsSync: makeExistsStub({ cx: false, lancedb: false }) });
    assert.equal(status.status, 'unavailable');
  });

  it('honors CONSTRUCT_LANCEDB_PATH override for the vector store probe', async () => {
    const custom = '/custom/lancedb';
    const existsStub = (p) => p === path.join(ROOT, '.construct') || p === custom;
    const status = await getStorageStatus(ROOT, { env: { CONSTRUCT_LANCEDB_PATH: custom }, fsExistsSync: existsStub });
    assert.equal(status.status, 'healthy');
  });
});
