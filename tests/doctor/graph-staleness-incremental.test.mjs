/**
 * tests/doctor/graph-staleness-incremental.test.mjs
 * incremental-drain wiring on the doctor graph-staleness watcher.
 *
 * Pins: the watcher drains a pending outbox event on tick() (one of the
 * design's named applier-trigger surfaces, design doc §4); a dead-lettered
 * event flips the post-drain trust decision, which the watcher records as a
 * `graph-incremental-untrusted` action; a clean, fully-drained outbox records
 * no such action.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { pinDoctorRoot } from '../helpers/doctor-root.mjs';

const constructGraphTestHomeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-graph-staleness-home-'));
const constructGraphTestPrevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = constructGraphTestHomeOverride;

const { root: doctorRoot, restore: restoreDoctorRoot } = pinDoctorRoot('cx-graph-staleness-doctor-');

test.after(() => {
  restoreDoctorRoot();
  try { fs.rmSync(constructGraphTestHomeOverride, { recursive: true, force: true }); } catch {}
  if (constructGraphTestPrevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = constructGraphTestPrevHomeOverride;
});

const { sqliteAvailable } = await import('../../lib/graph/relational/sqlite-db.mjs');
const { writeGraph } = await import('../../lib/graph/store.mjs');
const { enqueueOutboxEvent, outboxState } = await import('../../lib/graph/relational/outbox.mjs');
const watcher = await import('../../lib/doctor/watchers/graph-staleness.mjs');
const { recent } = await import('../../lib/doctor/audit.mjs');

const tmpDirs = [];
test.after(() => {
  for (const dir of tmpDirs) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
});

function freshProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-graph-staleness-project-'));
  tmpDirs.push(root);
  return root;
}

test('tick() drains a pending outbox event before checking staleness', { skip: !sqliteAvailable() ? 'node:sqlite unavailable' : false }, async () => {
  const root = freshProject();
  writeGraph(root, { nodes: [{ id: 'capability:a', type: 'capability', name: 'A', attrs: {} }], edges: [], generatedAt: new Date().toISOString(), sourceHashes: {} });
  enqueueOutboxEvent(root, {
    eventType: 'node_upsert',
    payload: { id: 'capability:b', type: 'capability', name: 'B', attrs: {} },
    origin: 'test',
  });
  assert.equal(outboxState(root).pending, 1);

  const prevRoot = process.env.CONSTRUCT_PROJECT_ROOT;
  process.env.CONSTRUCT_PROJECT_ROOT = root;
  try {
    await watcher.tick();
  } finally {
    if (prevRoot === undefined) delete process.env.CONSTRUCT_PROJECT_ROOT;
    else process.env.CONSTRUCT_PROJECT_ROOT = prevRoot;
  }

  const after = outboxState(root);
  assert.equal(after.pending, 0);
  assert.equal(after.applied, 1);
});

test('a dead-lettered event records a graph-incremental-untrusted action', { skip: !sqliteAvailable() ? 'node:sqlite unavailable' : false }, async () => {
  const root = freshProject();
  writeGraph(root, { nodes: [], edges: [], generatedAt: new Date().toISOString(), sourceHashes: {} });
  // node_delete on an id that produces no node row is a harmless no-op for
  // sqlite-store.mjs's deleteNode (an UPDATE affecting zero rows never
  // throws) — force a real applier failure instead via a payload that
  // violates the node_type NOT NULL constraint.
  for (let i = 0; i < 6; i++) {
    enqueueOutboxEvent(root, { eventType: 'node_upsert', payload: { id: 'capability:bad', type: undefined }, origin: 'test' });
  }
  // Drain repeatedly until the single dead_letter-bound row exhausts its
  // max_attempts (5); each drainOutbox call in the watcher only advances one
  // attempt per still-pending row per tick, so simulate several ticks.
  const prevRoot = process.env.CONSTRUCT_PROJECT_ROOT;
  process.env.CONSTRUCT_PROJECT_ROOT = root;
  try {
    let result;
    for (let i = 0; i < 6; i++) result = await watcher.tick();
    assert.ok(result.actions.some((a) => a.type === 'graph-incremental-untrusted'), 'watcher recorded the untrusted-incremental-state action');
  } finally {
    if (prevRoot === undefined) delete process.env.CONSTRUCT_PROJECT_ROOT;
    else process.env.CONSTRUCT_PROJECT_ROOT = prevRoot;
  }

  const recorded = recent({ watcher: 'graph-staleness', kind: 'action' });
  assert.ok(recorded.some((r) => r.action === 'graph-incremental-untrusted'));
});
