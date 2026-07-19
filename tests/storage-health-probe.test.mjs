/**
 * tests/storage-health-probe.test.mjs — unit tests for probeStorageHealth().
 *
 * Verifies that storage health is derived from real filesystem state plus a
 * live LanceDB open probe rather than hardcoded values. Uses injected
 * fsExistsSync and lancedbOpener stubs to avoid touching the real filesystem
 * or opening a real store.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { probeStorageHealth } from '../lib/status.mjs';
import { resolveStateDir } from '../lib/state-root.mjs';

const CWD = '/fake/project';

// Matches the machine-scoped state root (ADR-0066) probeStorageHealth actually
// resolves the lancedb store against, not a hardcoded `${CWD}/.construct/lancedb`.
const LANCEDB_STATE_PATH = resolveStateDir(CWD, 'lancedb', { ensureDir: false });

function makeExistsStub({ cx, lancedb }) {
  return (p) => {
    if (p === LANCEDB_STATE_PATH) return lancedb;
    if (p === `${CWD}/.construct`) return cx;
    return false;
  };
}

const openableStore = async () => ({ tableNames: async () => ['observations'] });
const brokenStore = async () => { throw new Error('corrupt manifest'); };

describe('probeStorageHealth', () => {
  it('returns healthy when .construct/lancedb exists and the store opens', async () => {
    const { sqlHealth, vectorStore } = await probeStorageHealth(CWD, {
      fsExistsSync: makeExistsStub({ cx: true, lancedb: true }),
      lancedbOpener: openableStore,
    });
    assert.equal(sqlHealth.status, 'healthy');
    assert.equal(sqlHealth.message, 'Local embedded');
    assert.equal(vectorStore.enabled, true);
    assert.equal(vectorStore.backend, 'lancedb');
  });

  it('returns unhealthy when the store exists but fails to open', async () => {
    const { sqlHealth, vectorStore } = await probeStorageHealth(CWD, {
      fsExistsSync: makeExistsStub({ cx: true, lancedb: true }),
      lancedbOpener: brokenStore,
      now: () => Number.MAX_SAFE_INTEGER,
    });
    assert.equal(sqlHealth.status, 'unhealthy');
    assert.match(sqlHealth.message, /corrupt manifest/);
    assert.equal(vectorStore.enabled, false);
  });

  it('returns degraded when .construct/ exists but .construct/lancedb is absent', async () => {
    const { sqlHealth, vectorStore } = await probeStorageHealth(CWD, {
      fsExistsSync: makeExistsStub({ cx: true, lancedb: false }),
    });
    assert.equal(sqlHealth.status, 'degraded');
    assert.match(sqlHealth.message, /no vector index yet/);
    assert.equal(vectorStore.enabled, false);
  });

  it('returns unavailable when .construct/ is absent', async () => {
    const { sqlHealth, vectorStore } = await probeStorageHealth(CWD, {
      fsExistsSync: makeExistsStub({ cx: false, lancedb: false }),
    });
    assert.equal(sqlHealth.status, 'unavailable');
    assert.match(sqlHealth.message, /not initialized/);
    assert.equal(vectorStore.enabled, false);
  });

  it('always returns the lancedb sqlStore shape regardless of fs state', async () => {
    const { sqlStore } = await probeStorageHealth(CWD, {
      fsExistsSync: makeExistsStub({ cx: false, lancedb: false }),
    });
    assert.equal(sqlStore.mode, 'lancedb');
    assert.equal(sqlStore.vectorEnabled, true);
    assert.equal(sqlStore.dbUrl, null);
  });
});
