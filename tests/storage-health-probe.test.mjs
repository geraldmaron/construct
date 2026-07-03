/**
 * tests/storage-health-probe.test.mjs — unit tests for probeStorageHealth().
 *
 * Verifies that storage health is derived from real filesystem state rather
 * than hardcoded values. Uses an injected fsExistsSync stub to avoid touching
 * the real filesystem.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { probeStorageHealth } from '../lib/status.mjs';

const CWD = '/fake/project';

function makeExistsStub({ cx, lancedb }) {
  return (p) => {
    if (p === `${CWD}/.cx/lancedb`) return lancedb;
    if (p === `${CWD}/.cx`) return cx;
    return false;
  };
}

describe('probeStorageHealth', () => {
  it('returns healthy when both .cx/ and .cx/lancedb exist', () => {
    const { sqlHealth, vectorStore } = probeStorageHealth(CWD, {
      fsExistsSync: makeExistsStub({ cx: true, lancedb: true }),
    });
    assert.equal(sqlHealth.status, 'healthy');
    assert.equal(sqlHealth.message, 'Local embedded');
    assert.equal(vectorStore.enabled, true);
    assert.equal(vectorStore.backend, 'lancedb');
  });

  it('returns degraded when .cx/ exists but .cx/lancedb is absent', () => {
    const { sqlHealth, vectorStore } = probeStorageHealth(CWD, {
      fsExistsSync: makeExistsStub({ cx: true, lancedb: false }),
    });
    assert.equal(sqlHealth.status, 'degraded');
    assert.match(sqlHealth.message, /no vector index yet/);
    assert.equal(vectorStore.enabled, false);
  });

  it('returns unavailable when .cx/ is absent', () => {
    const { sqlHealth, vectorStore } = probeStorageHealth(CWD, {
      fsExistsSync: makeExistsStub({ cx: false, lancedb: false }),
    });
    assert.equal(sqlHealth.status, 'unavailable');
    assert.match(sqlHealth.message, /not initialized/);
    assert.equal(vectorStore.enabled, false);
  });

  it('always returns the lancedb sqlStore shape regardless of fs state', () => {
    const { sqlStore } = probeStorageHealth(CWD, {
      fsExistsSync: makeExistsStub({ cx: false, lancedb: false }),
    });
    assert.equal(sqlStore.mode, 'lancedb');
    assert.equal(sqlStore.vectorEnabled, true);
    assert.equal(sqlStore.dbUrl, null);
  });
});
