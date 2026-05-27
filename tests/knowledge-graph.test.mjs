/**
 * tests/knowledge-graph.test.mjs — Unit coverage for lib/knowledge/graph.mjs.
 *
 * Pins the GraphRAG-foundation contract:
 *   - buildGraph derives undirected edges from `relatedEntities[]`.
 *   - detectCommunities is deterministic (sorted scan, lowest-id tiebreak).
 *   - summarizeCommunity ranks by intra-community degree centrality.
 *   - askGlobal returns structured communities scored by BM25, gracefully
 *     handles an empty graph, and skips singletons.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildGraph, detectCommunities, summarizeCommunity, askGlobal } from '../lib/knowledge/graph.mjs';

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function freshRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graphrag-'));
  tmpDirs.push(root);
  fs.mkdirSync(path.join(root, '.cx', 'observations'), { recursive: true });
  return root;
}

function writeEntities(root, entities) {
  fs.writeFileSync(path.join(root, '.cx', 'observations', 'entities.json'), JSON.stringify(entities, null, 2));
}

test('buildGraph derives an undirected adjacency from relatedEntities[]', () => {
  const root = freshRoot();
  writeEntities(root, [
    { name: 'a', summary: 'first', relatedEntities: ['b'] },
    { name: 'b', summary: 'second', relatedEntities: ['c'] },
    { name: 'c', summary: 'third', relatedEntities: [] },
  ]);
  const graph = buildGraph(root);
  assert.equal(graph.nodes.size, 3);
  assert.deepEqual([...graph.adj.get('a')], ['b']);
  assert.deepEqual([...graph.adj.get('b')].sort(), ['a', 'c']);
  assert.deepEqual([...graph.adj.get('c')], ['b']);
});

test('buildGraph silently drops edges to unknown entities', () => {
  const root = freshRoot();
  writeEntities(root, [
    { name: 'a', relatedEntities: ['missing'] },
  ]);
  const graph = buildGraph(root);
  assert.deepEqual([...graph.adj.get('a')], []);
});

test('detectCommunities is deterministic across repeated runs', () => {
  const root = freshRoot();
  // Two tight clusters joined by a single bridge edge. Label propagation can
  // collapse a thin bridge into one community; the deterministic contract
  // is what the test pins.
  writeEntities(root, [
    { name: 'a', relatedEntities: ['b', 'c'] },
    { name: 'b', relatedEntities: ['a', 'c'] },
    { name: 'c', relatedEntities: ['a', 'b', 'd'] },
    { name: 'd', relatedEntities: ['c', 'e'] },
    { name: 'e', relatedEntities: ['d', 'f', 'g'] },
    { name: 'f', relatedEntities: ['e', 'g'] },
    { name: 'g', relatedEntities: ['e', 'f'] },
  ]);
  const graph = buildGraph(root);
  const r1 = detectCommunities(graph);
  const r2 = detectCommunities(graph);
  for (const node of graph.nodes.keys()) {
    assert.equal(r1.labels.get(node), r2.labels.get(node), `label drift on ${node}`);
  }
  assert.equal(r1.communities.length, r2.communities.length);
});

test('detectCommunities separates fully disconnected components', () => {
  const root = freshRoot();
  // Two disjoint pairs: { a, b } and { c, d }. Any reasonable community
  // algorithm splits these — including label propagation.
  writeEntities(root, [
    { name: 'a', relatedEntities: ['b'] },
    { name: 'b', relatedEntities: ['a'] },
    { name: 'c', relatedEntities: ['d'] },
    { name: 'd', relatedEntities: ['c'] },
  ]);
  const graph = buildGraph(root);
  const { communities } = detectCommunities(graph);
  assert.ok(communities.length >= 2, `expected >=2 communities for disjoint pairs, got ${communities.length}`);
});

test('summarizeCommunity ranks members by intra-community degree', () => {
  const root = freshRoot();
  // Star: hub connected to three spokes. Hub should rank first.
  writeEntities(root, [
    { name: 'hub', summary: 'central node', relatedEntities: ['s1', 's2', 's3'] },
    { name: 's1', summary: 'spoke one', relatedEntities: ['hub'] },
    { name: 's2', summary: 'spoke two', relatedEntities: ['hub'] },
    { name: 's3', summary: 'spoke three', relatedEntities: ['hub'] },
  ]);
  const graph = buildGraph(root);
  const group = { id: 'hub', members: ['hub', 's1', 's2', 's3'] };
  const summary = summarizeCommunity(group, graph);
  assert.equal(summary.topMembers[0], 'hub');
  assert.ok(summary.summary.includes('hub'));
  assert.equal(summary.size, 4);
});

test('askGlobal returns empty result for an empty graph', () => {
  const root = freshRoot();
  const res = askGlobal({ query: 'anything', rootDir: root });
  assert.equal(res.totalEntities, 0);
  assert.deepEqual(res.communities, []);
});

test('askGlobal scores communities by overlap with the query terms', () => {
  const root = freshRoot();
  writeEntities(root, [
    // Auth cluster
    { name: 'oauth', summary: 'authentication protocol', relatedEntities: ['session', 'jwt'] },
    { name: 'session', summary: 'authentication state', relatedEntities: ['oauth', 'jwt'] },
    { name: 'jwt', summary: 'authentication token', relatedEntities: ['oauth', 'session'] },
    // Logging cluster
    { name: 'logger', summary: 'observability logging output', relatedEntities: ['span', 'trace'] },
    { name: 'span', summary: 'observability span', relatedEntities: ['logger', 'trace'] },
    { name: 'trace', summary: 'observability trace data', relatedEntities: ['logger', 'span'] },
  ]);
  const res = askGlobal({ query: 'authentication token', rootDir: root, topK: 5 });
  assert.ok(res.communities.length >= 1);
  // The top community must overlap with the auth cluster.
  const topMembers = new Set(res.communities[0].topMembers);
  const overlap = ['oauth', 'session', 'jwt'].filter((n) => topMembers.has(n));
  assert.ok(overlap.length >= 1, `top community ${[...topMembers].join(',')} missed the auth cluster`);
});

test('askGlobal skips singleton communities (minSize default 2)', () => {
  const root = freshRoot();
  writeEntities(root, [
    { name: 'isolated', summary: 'no neighbors', relatedEntities: [] },
    { name: 'pairA', summary: 'paired', relatedEntities: ['pairB'] },
    { name: 'pairB', summary: 'paired', relatedEntities: ['pairA'] },
  ]);
  const res = askGlobal({ query: 'paired', rootDir: root });
  for (const c of res.communities) {
    assert.ok(c.size >= 2, `singleton ${c.id} should have been skipped`);
  }
});
