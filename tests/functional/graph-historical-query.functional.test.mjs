/**
 * tests/functional/graph-historical-query.functional.test.mjs —
 * construct-4uxq0.11.16 historical graph snapshots, queries, and compaction.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'construct');

const {
  writeGraph, loadGraph, renameNode, nodeId, dependentsOf,
} = await import('../../lib/graph/store.mjs');
const {
  graphAtTime,
  whatChangedBetween,
  whatReplaced,
  whichReleaseRemoved,
  compactHistory,
  listSnapshots,
  provenanceFingerprint,
} = await import('../../lib/graph/history.mjs');

const graphHistoryTestHome = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-history-fn-home-'));
const graphHistoryPrevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = graphHistoryTestHome;
test.after(() => {
  if (graphHistoryPrevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = graphHistoryPrevHomeOverride;
  rmTmpDir(graphHistoryTestHome);
});

function freshRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'graph-history-fn-'));
}

function runConstruct(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

function writeBuild(root, generatedAt, nodes, edges = []) {
  writeGraph(root, { nodes, edges, generatedAt, sourceHash: generatedAt });
}

test('graphAtTime returns explicit no-history before first snapshot', () => {
  const root = freshRoot();
  try {
    const result = graphAtTime(root, '2026-01-01T00:00:00.000Z');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no-history');
    assert.match(result.message, /no history available before/);
  } finally {
    rmTmpDir(root);
  }
});

test('three successive builds archive snapshots queryable at each timestamp', () => {
  const root = freshRoot();
  try {
    const t1 = '2026-01-01T00:00:00.000Z';
    const t2 = '2026-01-02T00:00:00.000Z';
    const t3 = '2026-01-03T00:00:00.000Z';

    writeBuild(root, t1, [{ id: nodeId('capability', 'a'), type: 'capability', name: 'a' }]);
    writeBuild(root, t2, [
      { id: nodeId('capability', 'a'), type: 'capability', name: 'a' },
      { id: nodeId('capability', 'b'), type: 'capability', name: 'b' },
    ]);
    writeBuild(root, t3, [
      { id: nodeId('capability', 'a'), type: 'capability', name: 'a' },
      { id: nodeId('capability', 'b'), type: 'capability', name: 'b' },
      { id: nodeId('capability', 'c'), type: 'capability', name: 'c' },
    ]);

    assert.equal(listSnapshots(root).length, 2);

    const at1 = graphAtTime(root, t1);
    const at2 = graphAtTime(root, t2);
    const at3 = graphAtTime(root, t3);
    assert.equal(at1.ok, true);
    assert.equal(at2.ok, true);
    assert.equal(at3.ok, true);
    assert.deepEqual(at1.nodes.map((n) => n.id), [nodeId('capability', 'a')]);
    assert.deepEqual(at2.nodes.map((n) => n.id).sort(), [nodeId('capability', 'a'), nodeId('capability', 'b')].sort());
    assert.equal(at3.nodes.length, 3);
  } finally {
    rmTmpDir(root);
  }
});

test('renameNode and whatChangedBetween report renames through tombstone chain', () => {
  const root = freshRoot();
  try {
    const t1 = '2026-01-01T00:00:00.000Z';
    const t2 = '2026-01-02T00:00:00.000Z';
    const oldId = nodeId('capability', 'old-name');
    const newId = nodeId('capability', 'new-name');

    writeBuild(root, t1, [
      { id: oldId, type: 'capability', name: 'old-name' },
      { id: nodeId('test', 't1'), type: 'test', name: 't1' },
    ], [
      { from: nodeId('test', 't1'), to: oldId, rel: 'validates', source: 'registry' },
    ]);

    renameNode(root, oldId, newId);
    writeBuild(root, t2, [...loadGraph(root).nodes.values()], loadGraph(root).edges);

    const graph = loadGraph(root);
    assert.ok(graph.nodes.get(oldId)?.type === 'tombstone');
    assert.deepEqual(dependentsOf(graph, oldId, 'validates'), [nodeId('test', 't1')]);

    const replaced = whatReplaced(root, oldId);
    assert.equal(replaced.replacedBy, newId);

    const delta = whatChangedBetween(root, t1, t2);
    assert.equal(delta.ok, true);
    assert.ok(delta.changes.some((c) => c.kind === 'renamed' && c.from === oldId && c.to === newId));
  } finally {
    rmTmpDir(root);
  }
});

test('whichReleaseRemoved resolves release tag from released_in evidence edge', () => {
  const root = freshRoot();
  try {
    const capId = nodeId('capability', 'retired-cap');
    const releaseId = nodeId('runtime-evidence', 'release:v2.0.0');
    writeGraph(root, {
      nodes: [
        { id: capId, type: 'capability', name: 'retired-cap' },
        {
          id: releaseId,
          type: 'runtime-evidence',
          name: 'release:v2.0.0',
          attrs: { kind: 'release', tag: 'v2.0.0', timestamp: '2026-02-01T00:00:00.000Z' },
        },
      ],
      edges: [
        { from: releaseId, to: capId, rel: 'released_in', source: 'runtime-evidence' },
      ],
      generatedAt: '2026-02-01T00:00:00.000Z',
    });

    const result = whichReleaseRemoved(root, capId);
    assert.equal(result.release, 'v2.0.0');
  } finally {
    rmTmpDir(root);
  }
});

test('compactHistory prunes old snapshots but preserves live provenance fingerprint', () => {
  const root = freshRoot();
  try {
    const releaseId = nodeId('runtime-evidence', 'release:v1.0.0');
    const capId = nodeId('capability', 'removed');
    const mergeId = nodeId('runtime-evidence', 'merge:abc');

    for (let i = 0; i < 5; i += 1) {
      writeBuild(root, `2026-01-0${i + 1}T00:00:00.000Z`, [
        { id: capId, type: 'capability', name: 'removed' },
        { id: releaseId, type: 'runtime-evidence', name: 'release:v1.0.0', attrs: { kind: 'release', tag: 'v1.0.0' } },
        { id: mergeId, type: 'runtime-evidence', name: 'merge:abc', attrs: { kind: 'merge' } },
        { id: nodeId('capability', 'old'), type: 'tombstone', name: 'old', attrs: { supersededBy: capId } },
      ], [
        { from: releaseId, to: capId, rel: 'released_in', source: 'runtime-evidence' },
        { from: mergeId, to: nodeId('file', 'lib/a.mjs'), rel: 'merged_in', source: 'runtime-evidence' },
      ]);
    }

    assert.equal(listSnapshots(root).length, 4);
    const before = provenanceFingerprint(loadGraph(root));
    const compact = compactHistory(root, { maxSnapshots: 2 });
    assert.equal(compact.pruned, 2);
    assert.equal(compact.provenancePreserved, true);
    assert.equal(provenanceFingerprint(loadGraph(root)), before);
    assert.equal(listSnapshots(root).length, 2);
  } finally {
    rmTmpDir(root);
  }
});

test('construct graph history at queries archived snapshot through CLI', () => {
  const root = freshRoot();
  try {
    const ts = '2026-03-01T12:00:00.000Z';
    writeBuild(root, ts, [{ id: nodeId('workflow', 'demo'), type: 'workflow', name: 'demo' }]);
    writeBuild(root, '2026-03-02T12:00:00.000Z', [
      { id: nodeId('workflow', 'demo'), type: 'workflow', name: 'demo' },
      { id: nodeId('workflow', 'other'), type: 'workflow', name: 'other' },
    ]);

    const result = runConstruct(['graph', 'history', 'at', ts, '--json'], root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.nodes.length, 1);
    assert.equal(payload.nodes[0].id, nodeId('workflow', 'demo'));
  } finally {
    rmTmpDir(root);
  }
});
