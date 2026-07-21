/**
 * read-tracker-store.test.mjs — batching tests for read-efficiency persistence.
 *
 * Covers the JSONL delta path the Read hook writes and the Stop-hook flush
 * that folds deltas into the durable session summary.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyReadDelta,
  flushReadTrackerDeltas,
  freshEfficiencyStats,
  recordReadDelta,
  readTrackerPaths,
} from '../lib/read-tracker-store.mjs';

test('applyReadDelta accumulates repeated reads and warning timestamps', () => {
  const stats = freshEfficiencyStats('2026-05-21T00:00:00.000Z');
  for (let i = 0; i < 5; i++) {
    applyReadDelta(stats, {
      path: '/tmp/file-a.mjs',
      size: 100,
      limit: 500,
      ts: `2026-05-21T00:00:0${i}.000Z`,
    }, { HOME: os.tmpdir() });
  }

  assert.equal(stats.readCount, 5);
  assert.equal(stats.uniqueFileCount, 1);
  assert.equal(stats.repeatedReadCount, 4);
  assert.ok(stats.largeReadCount >= 5);
});

test('flushReadTrackerDeltas compacts appended deltas into session-efficiency.json', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-read-tracker-'));
  const env = { HOME: home };

  recordReadDelta({
    path: '/tmp/a.mjs',
    size: 120,
    limit: 100,
    ts: '2026-05-21T00:00:00.000Z',
  }, env);
  recordReadDelta({
    path: '/tmp/a.mjs',
    size: 120,
    limit: 100,
    ts: '2026-05-21T00:00:01.000Z',
  }, env);
  recordReadDelta({
    path: '/tmp/b.mjs',
    size: 64,
    limit: 50,
    ts: '2026-05-21T00:00:02.000Z',
  }, env);

  const stats = flushReadTrackerDeltas({ nowIso: '2026-05-21T00:00:03.000Z', env });
  assert.equal(stats.readCount, 3);
  assert.equal(stats.uniqueFileCount, 2);
  assert.equal(stats.repeatedReadCount, 1);

  const paths = readTrackerPaths(env);
  assert.equal(fs.existsSync(paths.deltaLog), false);
  const persisted = JSON.parse(fs.readFileSync(paths.efficiencyStore, 'utf8'));
  assert.equal(persisted.readCount, 3);

  fs.rmSync(home, { recursive: true, force: true });
});

test('readTrackerPaths honors CONSTRUCT_HOME_OVERRIDE for machine state', () => {
  const constructHome = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-read-tracker-home-'));
  const otherHome = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-read-tracker-other-'));
  try {
    const paths = readTrackerPaths({ CONSTRUCT_HOME_OVERRIDE: constructHome, HOME: otherHome });
    assert.equal(paths.constructDir, path.join(constructHome, '.local', 'state', 'construct'));
    assert.equal(paths.efficiencyStore, path.join(paths.constructDir, 'session-efficiency.json'));
  } finally {
    fs.rmSync(constructHome, { recursive: true, force: true });
    fs.rmSync(otherHome, { recursive: true, force: true });
  }
});
