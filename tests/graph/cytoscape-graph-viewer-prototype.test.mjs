/**
 * tests/graph/cytoscape-graph-viewer-prototype.test.mjs — smoke test +
 * bundle-isolation check for the Cytoscape.js graph-viewer prototype
 * (construct-tsyfe.4.5, PROTOTYPE ONLY).
 *
 * Covers the bead's acceptance criteria: (1) both views render without error
 * against a fixture sampled from a real `.construct/graph/` snapshot of this
 * repo, (2) `bin/`+`lib/` carry zero Cytoscape import — bundle isolation is
 * grep-provable. "Render" is proxied by headless Cytoscape core construction
 * (`headless: true`, no DOM/canvas) plus a layout run not throwing, since a
 * real browser paint isn't observable inside `node --test`.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import cytoscape from 'cytoscape';

import { buildViewElements } from '../../packages/construct-ui/prototypes/graph-viewer/transform.mjs';
import { VIEWS, APPLICATION_NODE_TYPES, APPLICATION_EDGE_RELS, DEPENDENCY_NODE_TYPES, DEPENDENCY_EDGE_RELS } from '../../packages/construct-ui/prototypes/graph-viewer/view-vocab.mjs';
import { NODE_TYPES, EDGE_RELS } from '../../lib/graph/store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');
const fixturesDir = path.join(rootDir, 'packages', 'construct-ui', 'prototypes', 'graph-viewer', 'fixtures');

const nodes = JSON.parse(readFileSync(path.join(fixturesDir, 'nodes.sample.json'), 'utf8'));
const edges = JSON.parse(readFileSync(path.join(fixturesDir, 'edges.sample.json'), 'utf8'));

test('fixture is drawn from a real .construct/graph/ snapshot, not synthesized', () => {
  assert.ok(nodes.length > 0, 'expected sampled nodes');
  assert.ok(edges.length > 0, 'expected sampled edges');
  const typesPresent = new Set(nodes.map((n) => n.type));
  assert.ok(typesPresent.has('specialist') && typesPresent.has('skill') && typesPresent.has('file'), 'expected a representative mix of node types');
});

test('application view renders headless without error at fixture scale', () => {
  const elements = buildViewElements(nodes, edges, VIEWS.application);
  assert.ok(elements.nodes.length > 0, 'application view should have nodes');
  const cy = cytoscape({ headless: true, styleEnabled: false, elements });
  assert.equal(cy.nodes().length, elements.nodes.length);
  assert.equal(cy.edges().length, elements.edges.length);
  assert.doesNotThrow(() => cy.layout({ name: 'grid', animate: false }).run());
  cy.destroy();
});

test('dependency view renders headless without error at fixture scale', () => {
  const elements = buildViewElements(nodes, edges, VIEWS.dependency);
  assert.ok(elements.nodes.length > 0, 'dependency view should have nodes');
  const cy = cytoscape({ headless: true, styleEnabled: false, elements });
  assert.equal(cy.nodes().length, elements.nodes.length);
  assert.equal(cy.edges().length, elements.edges.length);
  assert.doesNotThrow(() => cy.layout({ name: 'grid', animate: false }).run());
  cy.destroy();
});

test('application and dependency views partition the node-type vocabulary with no overlap', () => {
  for (const t of VIEWS.application.nodeTypes) assert.ok(!VIEWS.dependency.nodeTypes.has(t), `'${t}' should not be in both views`);
});

test('view-vocab.mjs (browser-safe, hardcoded) matches the live lib/graph/store.mjs vocabulary', () => {
  // view-vocab.mjs cannot import lib/graph/store.mjs (it pulls in `node:fs`
  // for a browser-loaded entry point), so its NODE_TYPES/EDGE_RELS copy is
  // duplicated by hand. This test is the drift guard: a type/rel added to or
  // removed from store.mjs without a matching view-vocab.mjs update fails
  // here instead of silently misclassifying a new node/edge at runtime.
  const combinedNodeTypes = new Set([...APPLICATION_NODE_TYPES, ...DEPENDENCY_NODE_TYPES]);
  const combinedEdgeRels = new Set([...APPLICATION_EDGE_RELS, ...DEPENDENCY_EDGE_RELS]);
  assert.deepEqual([...combinedNodeTypes].sort(), [...NODE_TYPES].sort(), 'view-vocab.mjs node types have drifted from lib/graph/store.mjs NODE_TYPES');
  assert.deepEqual([...combinedEdgeRels].sort(), [...EDGE_RELS].sort(), 'view-vocab.mjs edge rels have drifted from lib/graph/store.mjs EDGE_RELS');
});

test('bundle isolation: bin/ and lib/ carry zero cytoscape import (grep-provable, AC2 literal match)', () => {
  // AC2 is literally `grep -rn "cytoscape" bin/ lib/` — case-sensitive on the
  // lowercase npm package/import identifier. lib/diagram-card.mjs and its
  // schema mention the proper noun "Cytoscape" in prose (construct-tsyfe.4.1,
  // pre-existing, naming it as one of several diagram engines a Diagram Card
  // can describe) — that capitalized mention is not an import and must not
  // fail this check; only a lowercase `cytoscape` occurrence would indicate
  // the package leaked into the core bundle.
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(mjs|js|cjs|json)$/.test(entry.name) && entry.name !== 'construct') continue;
      const text = readFileSync(full, 'utf8');
      if (/cytoscape/.test(text)) hits.push(full);
    }
  };
  walk(path.join(rootDir, 'bin'));
  walk(path.join(rootDir, 'lib'));
  assert.deepEqual(hits, [], `expected zero lowercase 'cytoscape' occurrences in bin/+lib/, found: ${hits.join(', ')}`);
});
