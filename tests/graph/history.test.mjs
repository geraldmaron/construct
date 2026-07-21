/**
 * tests/graph/history.test.mjs — unit coverage for lib/graph/history.mjs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeGraph, nodeId } from '../../lib/graph/store.mjs';
import {
  archiveGraphBeforeWrite,
  listSnapshots,
  graphAtTime,
  compactHistory,
} from '../../lib/graph/history.mjs';

const graphHistoryUnitHome = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-history-unit-home-'));
const graphHistoryUnitPrevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = graphHistoryUnitHome;

const tmpDirs = [];
test.after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  if (graphHistoryUnitPrevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = graphHistoryUnitPrevHomeOverride;
  try { fs.rmSync(graphHistoryUnitHome, { recursive: true, force: true }); } catch {}
});

function freshRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-history-unit-'));
  tmpDirs.push(root);
  return root;
}

test('archiveGraphBeforeWrite is a no-op when no prior graph exists', () => {
  const root = freshRoot();
  const result = archiveGraphBeforeWrite(root);
  assert.equal(result.archived, false);
  assert.equal(result.reason, 'no-prior-graph');
});

test('archiveGraphBeforeWrite stores prior snapshot once per generatedAt', () => {
  const root = freshRoot();
  const ts = '2026-04-01T00:00:00.000Z';
  writeGraph(root, {
    nodes: [{ id: nodeId('file', 'a.mjs'), type: 'file', name: 'a.mjs' }],
    edges: [],
    generatedAt: ts,
  });
  writeGraph(root, {
    nodes: [{ id: nodeId('file', 'b.mjs'), type: 'file', name: 'b.mjs' }],
    edges: [],
    generatedAt: '2026-04-02T00:00:00.000Z',
  });
  assert.equal(listSnapshots(root).length, 1);
  const snap = graphAtTime(root, ts);
  assert.equal(snap.ok, true);
  assert.equal(snap.nodes[0].id, nodeId('file', 'a.mjs'));
});

test('compactHistory retains minimum snapshot count', () => {
  const root = freshRoot();
  writeGraph(root, { nodes: [{ id: 'file:a', type: 'file' }], edges: [], generatedAt: '2026-05-01T00:00:00.000Z' });
  writeGraph(root, { nodes: [{ id: 'file:b', type: 'file' }], edges: [], generatedAt: '2026-05-02T00:00:00.000Z' });
  writeGraph(root, { nodes: [{ id: 'file:c', type: 'file' }], edges: [], generatedAt: '2026-05-03T00:00:00.000Z' });
  const result = compactHistory(root, { maxSnapshots: 1 });
  assert.equal(result.retained, 2);
  assert.equal(listSnapshots(root).length, 2);
});
