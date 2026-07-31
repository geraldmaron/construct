/**
 * tests/graph/store.test.mjs — unit coverage for the typed dependency-graph store.
 *
 * Pins: deterministic round-trip (sorted nodes/edges), node de-dup with attr
 * merge, edge de-dup with weight accumulation and source union, and the
 * forward/reverse adjacency queries (dependenciesOf / dependentsOf / nodesByType).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  writeGraph, loadGraph, dependenciesOf, dependentsOf, nodesByType, nodeId, renameNode,
} from '../../lib/graph/store.mjs';

// the relational graph store (lib/graph/relational/)
// resolves graph.db under the machine-scoped state root (resolveStateDir)
// whenever writeGraph/loadGraph touch the host graph on Node
// >=22.5. Pin CONSTRUCT_HOME_OVERRIDE so this suite never provisions state under
// the real developer machine's ~/.construct/projects/ (the isolation
// contract, tests/functional/README.md) — the same pattern
// tests/orchestration-run-store-sqlite.test.mjs already established.

const constructGraphTestHomeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-graph-test-home-'));
const constructGraphTestPrevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = constructGraphTestHomeOverride;
test.after(() => {
  try { fs.rmSync(constructGraphTestHomeOverride, { recursive: true, force: true }); } catch {}
  if (constructGraphTestPrevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = constructGraphTestPrevHomeOverride;
});


const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function freshRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-store-'));
  tmpDirs.push(root);
  return root;
}

test('writeGraph + loadGraph round-trips nodes, edges, and meta counts', () => {
  const root = freshRoot();
  const nodes = [
    { id: nodeId('capability', 'a'), type: 'capability', name: 'A', attrs: { criticality: 'P0' } },
    { id: nodeId('test', 't1'), type: 'test', name: 't1', attrs: {} },
    { id: nodeId('procedure', 'w'), type: 'procedure', name: 'w', attrs: {} },
  ];
  const edges = [
    { from: nodeId('test', 't1'), to: nodeId('capability', 'a'), rel: 'validates', source: 'registry' },
    { from: nodeId('capability', 'a'), to: nodeId('procedure', 'w'), rel: 'embeds', source: 'registry' },
  ];
  const res = writeGraph(root, { nodes, edges, generatedAt: '2026-01-01T00:00:00.000Z', sourceHash: 'abc' });
  assert.equal(res.nodeCount, 3);
  assert.equal(res.edgeCount, 2);

  const graph = loadGraph(root);
  assert.equal(graph.exists, true);
  assert.equal(graph.nodes.size, 3);
  assert.equal(graph.edges.length, 2);
  assert.equal(graph.meta.sourceHash, 'abc');
  assert.equal(graph.meta.schemaVersion, 1);
  assert.equal(graph.meta.nodesByType.capability, 1);
  assert.equal(graph.meta.edgesByRel.validates, 1);
  assert.deepEqual(graph.nodes.get(nodeId('capability', 'a')).attrs, { criticality: 'P0' });
});

test('new node types round-trip correctly', () => {
  const root = freshRoot();
  const nodeTypes = ['provider', 'tool', 'pack', 'doc', 'specialist', 'runtime-evidence'];
  const nodes = nodeTypes.map((t, i) => ({ id: nodeId(t, `key${i}`), type: t, name: `${t}-name` }));
  writeGraph(root, { nodes, edges: [] });
  const graph = loadGraph(root);
  assert.equal(graph.nodes.size, nodeTypes.length);
  for (const n of nodes) {
    const loaded = graph.nodes.get(n.id);
    assert.ok(loaded, `node ${n.id} loaded`);
    assert.equal(loaded.type, n.type);
    assert.equal(loaded.name, n.name);
  }
  for (const t of nodeTypes) {
    assert.equal(graph.meta.nodesByType[t], 1, `meta.counts.${t} === 1`);
  }
});

test('new edge types round-trip correctly', () => {
  const root = freshRoot();
  const nodes = [
    { id: nodeId('provider', 'p1'), type: 'provider', name: 'p1' },
    { id: nodeId('tool', 't1'), type: 'tool', name: 't1' },
    { id: nodeId('pack', 'pk1'), type: 'pack', name: 'pk1' },
    { id: nodeId('doc', 'd1'), type: 'doc', name: 'd1' },
    { id: nodeId('specialist', 's1'), type: 'specialist', name: 's1' },
    { id: nodeId('runtime-evidence', 'e1'), type: 'runtime-evidence', name: 'e1' },
  ];
  const edges = [
    { from: nodeId('provider', 'p1'), to: nodeId('tool', 't1'), rel: 'requires', source: 'registry' },
    { from: nodeId('doc', 'd1'), to: nodeId('provider', 'p1'), rel: 'documents', source: 'registry' },
    { from: nodeId('runtime-evidence', 'e1'), to: nodeId('provider', 'p1'), rel: 'evidenced_by', source: 'registry' },
    { from: nodeId('tool', 't1'), to: nodeId('pack', 'pk1'), rel: 'owned_by', source: 'registry' },
  ];
  writeGraph(root, { nodes, edges });
  const graph = loadGraph(root);
  assert.equal(graph.edges.length, 4);
  assert.equal(graph.meta.edgesByRel.requires, 1);
  assert.equal(graph.meta.edgesByRel.documents, 1);
  assert.equal(graph.meta.edgesByRel.evidenced_by, 1);
  assert.equal(graph.meta.edgesByRel.owned_by, 1);
  const key = `${nodeId('provider', 'p1')}|requires|${nodeId('tool', 't1')}`;
  const found = graph.edges.find((e) => `${e.from}|${e.rel}|${e.to}` === key);
  assert.ok(found, 'requires edge present');
  assert.equal(found.weight, 1);
});

test('meta includes schemaVersion: 1 after writeGraph', () => {
  const root = freshRoot();
  writeGraph(root, { nodes: [{ id: 'file:a', type: 'file' }], edges: [] });
  const graph = loadGraph(root);
  assert.ok(graph.meta, 'meta exists');
  assert.equal(graph.meta.schemaVersion, 1);
});

test('new node types are accepted by normalizeNodes', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: nodeId('provider', 'aws'), type: 'provider', name: 'AWS' },
      { id: nodeId('tool', 'terraform'), type: 'tool', name: 'Terraform' },
      { id: nodeId('pack', 'compute'), type: 'pack', name: 'Compute Pack' },
      { id: nodeId('doc', 'api-ref'), type: 'doc', name: 'API Reference' },
      { id: nodeId('specialist', 'network'), type: 'specialist', name: 'Network Specialist' },
      { id: nodeId('runtime-evidence', 'latency'), type: 'runtime-evidence', name: 'Latency Report' },
    ],
    edges: [],
  });
  const graph = loadGraph(root);
  assert.equal(graph.nodes.size, 6);
});

test('nodes are written sorted by id for clean diffs', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: 'z:1', type: 'file' },
      { id: 'a:1', type: 'file' },
      { id: 'm:1', type: 'module' },
    ],
    edges: [],
  });
  const raw = fs.readFileSync(path.join(root, '.construct', 'graph', 'nodes.jsonl'), 'utf8').trim().split('\n');
  const ids = raw.map((l) => JSON.parse(l).id);
  assert.deepEqual(ids, ['a:1', 'm:1', 'z:1']);
});

test('duplicate nodes merge attrs (last write wins per key)', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: 'capability:a', type: 'capability', attrs: { criticality: 'P0', humanGate: 'proposal-only' } },
      { id: 'capability:a', type: 'capability', attrs: { lastValidated: '2026-01-01' } },
    ],
    edges: [],
  });
  const node = loadGraph(root).nodes.get('capability:a');
  assert.equal(node.attrs.criticality, 'P0');
  assert.equal(node.attrs.lastValidated, '2026-01-01');
});

test('duplicate edges accumulate weight and union sources', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [{ id: 'file:a', type: 'file' }, { id: 'file:b', type: 'file' }],
    edges: [
      { from: 'file:a', to: 'file:b', rel: 'co_changes', source: 'co-change' },
      { from: 'file:a', to: 'file:b', rel: 'co_changes', source: 'co-change' },
      { from: 'file:a', to: 'file:b', rel: 'co_changes', source: 'override' },
    ],
  });
  const graph = loadGraph(root);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].weight, 3);
  assert.deepEqual(graph.edges[0].sources.sort(), ['co-change', 'override']);
});

test('dependenciesOf / dependentsOf traverse the directed graph with rel filter', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: 'capability:a', type: 'capability' },
      { id: 'workflow:w', type: 'workflow' },
      { id: 'test:t', type: 'test' },
      { id: 'skill:s', type: 'skill' },
    ],
    edges: [
      { from: 'capability:a', to: 'workflow:w', rel: 'embeds', source: 'registry' },
      { from: 'capability:a', to: 'skill:s', rel: 'uses', source: 'registry' },
      { from: 'test:t', to: 'capability:a', rel: 'validates', source: 'registry' },
    ],
  });
  const graph = loadGraph(root);
  assert.deepEqual(dependenciesOf(graph, 'capability:a').sort(), ['skill:s', 'workflow:w']);
  assert.deepEqual(dependenciesOf(graph, 'capability:a', 'embeds'), ['workflow:w']);
  assert.deepEqual(dependentsOf(graph, 'capability:a'), ['test:t']);
  assert.deepEqual(dependentsOf(graph, 'capability:a', 'validates'), ['test:t']);
  assert.equal(nodesByType(graph, 'capability').length, 1);
});

test('loadGraph on an empty root reports non-existent without throwing', () => {
  const root = freshRoot();
  const graph = loadGraph(root);
  assert.equal(graph.exists, false);
  assert.equal(graph.nodes.size, 0);
  assert.deepEqual(dependenciesOf(graph, 'whatever'), []);
});

// writeGraph/loadGraph carry partial/partialReasons so
// a rebuild that collected fewer than all its seed sources can mark itself
// as such instead of meta.json silently reporting a full build.

test('writeGraph defaults partial to false when not passed', () => {
  const root = freshRoot();
  writeGraph(root, { nodes: [{ id: 'file:a', type: 'file' }], edges: [] });
  const graph = loadGraph(root);
  assert.equal(graph.meta.partial, false);
  assert.deepEqual(graph.meta.partialReasons, []);
});

test('writeGraph persists partial: true with its reasons', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [{ id: 'file:a', type: 'file' }],
    edges: [],
    partial: true,
    partialReasons: ['buildFromRegistry threw: Modular org not found'],
  });
  const graph = loadGraph(root);
  assert.equal(graph.meta.partial, true);
  assert.deepEqual(graph.meta.partialReasons, ['buildFromRegistry threw: Modular org not found']);
});

test('loadGraph treats a meta.json with no partial field as false', () => {
  const root = freshRoot();
  writeGraph(root, { nodes: [{ id: 'file:a', type: 'file' }], edges: [] });
  const metaPath = path.join(root, '.construct', 'graph', 'meta.json');
  const legacyMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  delete legacyMeta.partial;
  delete legacyMeta.partialReasons;
  fs.writeFileSync(metaPath, JSON.stringify(legacyMeta, null, 2));

  const graph = loadGraph(root);
  assert.equal(graph.meta.partial, false);
  assert.deepEqual(graph.meta.partialReasons, []);
});

// renameNode moves a node to a new id without dropping
// history — every edge referencing the old id is rewritten, the old id
// becomes a tombstone (attrs.supersededBy), and dependenciesOf/dependentsOf
// resolve the old id through the tombstone to the live node's edges.

test('renameNode rewires edges, tombstones the old id, and aliases the new node', () => {
  const root = freshRoot();
  const oldId = nodeId('capability', 'old-name');
  const newId = nodeId('capability', 'new-name');
  writeGraph(root, {
    nodes: [
      { id: oldId, type: 'capability', name: 'old-name' },
      { id: nodeId('procedure', 'w'), type: 'procedure', name: 'w' },
      { id: nodeId('test', 't'), type: 'test', name: 't' },
    ],
    edges: [
      { from: oldId, to: nodeId('procedure', 'w'), rel: 'embeds', source: 'registry' },
      { from: nodeId('test', 't'), to: oldId, rel: 'validates', source: 'registry' },
    ],
  });

  const result = renameNode(root, oldId, newId);
  assert.deepEqual(result, { renamed: true, oldId, newId, tombstoneId: oldId });

  const graph = loadGraph(root);
  const tombstone = graph.nodes.get(oldId);
  assert.equal(tombstone.type, 'tombstone');
  assert.equal(tombstone.attrs.supersededBy, newId);

  const renamed = graph.nodes.get(newId);
  assert.equal(renamed.type, 'capability');
  assert.deepEqual(renamed.attrs.aliases, [oldId]);

  assert.deepEqual(dependenciesOf(graph, newId, 'embeds'), [nodeId('procedure', 'w')]);
  assert.deepEqual(dependentsOf(graph, newId, 'validates'), [nodeId('test', 't')]);

  // The pre-rename id resolves through the tombstone to the same edges,
  // not an empty result.
  assert.deepEqual(dependenciesOf(graph, oldId, 'embeds'), [nodeId('procedure', 'w')]);
  assert.deepEqual(dependentsOf(graph, oldId, 'validates'), [nodeId('test', 't')]);
});

test('renameNode rejects renaming a nonexistent node or onto an existing id', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: 'capability:a', type: 'capability' },
      { id: 'capability:b', type: 'capability' },
    ],
    edges: [],
  });
  assert.throws(() => renameNode(root, 'capability:ghost', 'capability:c'), /node not found/);
  assert.throws(() => renameNode(root, 'capability:a', 'capability:b'), /target id already exists/);
});
