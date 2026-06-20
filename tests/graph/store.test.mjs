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
  writeGraph, loadGraph, dependenciesOf, dependentsOf, nodesByType, nodeId,
} from '../../lib/graph/store.mjs';

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
    { id: nodeId('workflow', 'w'), type: 'workflow', name: 'w', attrs: {} },
  ];
  const edges = [
    { from: nodeId('test', 't1'), to: nodeId('capability', 'a'), rel: 'validates', source: 'registry' },
    { from: nodeId('capability', 'a'), to: nodeId('workflow', 'w'), rel: 'embeds', source: 'registry' },
  ];
  const res = writeGraph(root, { nodes, edges, generatedAt: '2026-01-01T00:00:00.000Z', sourceHash: 'abc' });
  assert.equal(res.nodeCount, 3);
  assert.equal(res.edgeCount, 2);

  const graph = loadGraph(root);
  assert.equal(graph.exists, true);
  assert.equal(graph.nodes.size, 3);
  assert.equal(graph.edges.length, 2);
  assert.equal(graph.meta.sourceHash, 'abc');
  assert.equal(graph.meta.nodesByType.capability, 1);
  assert.equal(graph.meta.edgesByRel.validates, 1);
  assert.deepEqual(graph.nodes.get(nodeId('capability', 'a')).attrs, { criticality: 'P0' });
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
  const raw = fs.readFileSync(path.join(root, '.cx', 'graph', 'nodes.jsonl'), 'utf8').trim().split('\n');
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
