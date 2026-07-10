/**
 * tests/status-storage-probe.test.mjs — LanceDB storage health probe tests.
 *
 * Verifies that probeStorageHealth:
 *   1. Returns healthy when the LanceDB opener succeeds.
 *   2. Returns unhealthy (with reason) when the opener throws (corrupt/locked store).
 *   3. Returns unhealthy (with reason) when the opener times out.
 *   4. Caches the result so repeated calls skip the opener.
 *   5. Completes the healthy path in under 100ms overhead.
 *
 * The opener is injected so no real LanceDB files are required. The lancedb
 * fixture lands at the machine-scoped state root (ADR-0066), matching where
 * probeStorageHealth actually resolves it, so CX_HOME_OVERRIDE is pinned for
 * the whole file to keep that write off the real developer machine's $HOME.
 *
 * Bead: construct-9oi4.13.1 — LMCP-M1
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { probeStorageHealth } from '../lib/status.mjs';
import { resolveStateDir } from '../lib/state-root.mjs';
import { tempDir } from './helpers.mjs';

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-storage-probe-home-'));
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

// Create a minimal fake directory structure with the lancedb store present at
// its machine-scoped state root (ADR-0066), plus the project-local `.cx/`
// marker probeStorageHealth checks first.
function makeLancedbFixture() {
  const cwd = tempDir('construct-storage-probe-');
  fs.mkdirSync(path.join(cwd, '.construct'), { recursive: true });
  const lancedbPath = resolveStateDir(cwd, 'lancedb', { ensureDir: false });
  fs.mkdirSync(lancedbPath, { recursive: true });
  return { cwd, lancedbPath };
}

// A healthy opener: resolves immediately with a db that has tableNames().
function healthyOpener() {
  return async (_path) => ({
    tableNames: async () => [],
  });
}

// A corrupt opener: rejects immediately.
function corruptOpener(message = 'SQLITE_CORRUPT: file is not a database') {
  return async (_path) => {
    throw new Error(message);
  };
}

// A locked/slow opener: never resolves within normal time (simulated by a very long delay).
function lockedOpener({ delayMs = 10000 } = {}) {
  return async (_path) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return { tableNames: async () => [] };
  };
}

test('probeStorageHealth healthy: returns healthy when lancedb opens and tableNames succeeds', async () => {
  const { cwd } = makeLancedbFixture();

  const result = await probeStorageHealth(cwd, {
    lancedbOpener: healthyOpener(),
    now: () => 0,  // force cache miss by using a unique "now"
  });

  assert.equal(result.sqlHealth.status, 'healthy', 'sqlHealth.status should be healthy');
  assert.equal(typeof result.sqlHealth.message, 'string', 'sqlHealth.message should be a string');
  assert.equal(result.vectorStore.enabled, true, 'vectorStore.enabled should be true on healthy');
});

test('probeStorageHealth corrupt: returns unhealthy with reason when opener throws', async () => {
  const { cwd } = makeLancedbFixture();
  const errorMessage = 'SQLITE_CORRUPT: file is not a database';

  let nowValue = 0;
  const result = await probeStorageHealth(cwd, {
    lancedbOpener: corruptOpener(errorMessage),
    now: () => { nowValue += 1000000; return nowValue; }, // always cache-miss
  });

  assert.equal(result.sqlHealth.status, 'unhealthy', 'sqlHealth.status should be unhealthy for corrupt store');
  assert.ok(
    result.sqlHealth.message && result.sqlHealth.message.length > 0,
    'sqlHealth.message should be non-empty for corrupt store',
  );
  assert.match(
    result.sqlHealth.message,
    /LanceDB open failed/,
    'message should mention LanceDB open failed',
  );
  assert.equal(result.vectorStore.enabled, false, 'vectorStore.enabled should be false on unhealthy');
});

test('probeStorageHealth locked: returns unhealthy with timeout reason when opener hangs', async () => {
  const { cwd } = makeLancedbFixture();

  let nowValue = 2000000;
  const result = await probeStorageHealth(cwd, {
    lancedbOpener: lockedOpener({ delayMs: 5000 }),
    probeTimeoutMs: 50,  // very short timeout so test doesn't take 5s
    now: () => { nowValue += 1000000; return nowValue; }, // always cache-miss
  });

  assert.equal(result.sqlHealth.status, 'unhealthy', 'sqlHealth.status should be unhealthy for locked store');
  assert.match(
    result.sqlHealth.message,
    /timed out/i,
    'message should mention timeout for locked store',
  );
  assert.equal(result.vectorStore.enabled, false, 'vectorStore.enabled should be false on timeout');
});

test('probeStorageHealth caching: repeated calls within TTL skip the opener', async () => {
  const { cwd } = makeLancedbFixture();

  let openerCallCount = 0;
  const countingOpener = async (_path) => {
    openerCallCount += 1;
    return { tableNames: async () => [] };
  };

  const fixedNow = Date.now();
  const opts = {
    lancedbOpener: countingOpener,
    now: () => fixedNow,  // same timestamp = always within TTL after first call
  };

  await probeStorageHealth(cwd, opts);
  await probeStorageHealth(cwd, opts);
  await probeStorageHealth(cwd, opts);

  assert.equal(openerCallCount, 1, 'opener should only be called once; subsequent calls should use cache');
});

test('probeStorageHealth absent .cx/: returns unavailable without calling opener', async () => {
  const cwd = tempDir('construct-storage-probe-nocx-');
  // No .cx dir created.

  let openerCalled = false;
  const result = await probeStorageHealth(cwd, {
    lancedbOpener: async () => { openerCalled = true; return { tableNames: async () => [] }; },
    now: () => Date.now(),
  });

  assert.equal(result.sqlHealth.status, 'unavailable', 'should be unavailable when .cx/ is absent');
  assert.equal(openerCalled, false, 'opener should not be called when .cx/ is absent');
});

test('probeStorageHealth absent .cx/lancedb: returns degraded without calling opener', async () => {
  const cwd = tempDir('construct-storage-probe-nolancedb-');
  fs.mkdirSync(path.join(cwd, '.construct'), { recursive: true });
  // .cx/ exists but .cx/lancedb does not.

  let openerCalled = false;
  const result = await probeStorageHealth(cwd, {
    lancedbOpener: async () => { openerCalled = true; return { tableNames: async () => [] }; },
    now: () => Date.now(),
  });

  assert.equal(result.sqlHealth.status, 'degraded', 'should be degraded when .cx/lancedb is absent');
  assert.equal(openerCalled, false, 'opener should not be called when lancedb dir is absent');
});

test('probeStorageHealth healthy path: completes in under 100ms', async () => {
  const { cwd } = makeLancedbFixture();

  const uniqueNow = Date.now() + Math.random() * 1e9;  // unique clock to avoid cache from other tests
  let callIndex = 0;

  const start = Date.now();
  await probeStorageHealth(cwd, {
    lancedbOpener: healthyOpener(),
    now: () => uniqueNow + (callIndex++ * 1e9),
  });
  const elapsed = Date.now() - start;

  assert.ok(
    elapsed < 100,
    `healthy probe should complete in under 100ms; took ${elapsed}ms`,
  );
});
