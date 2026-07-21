/**
 * tests/diagram-card.test.mjs — Diagram Card schema + dot-fallback wiring tests.
 *
 * Covers construct-tsyfe.4.1 contract validation and construct-tsyfe.4.4 explicit
 * Graphviz fallback degradation on renderer selection and Diagram Cards.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  buildDiagramCard,
  diagramCardToGraphNode,
  loadDiagramCardSchema,
  validateDiagramCard,
} from '../lib/diagram-card.mjs';
import {
  DOT_FALLBACK_REASON,
  describeRendererSelection,
} from '../lib/diagram.mjs';
import { EDGE_RELS, NODE_TYPES } from '../lib/graph/store.mjs';

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'diagram-card');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

test('diagram card schema matches contract-schemas top-level shape', () => {
  const schema = loadDiagramCardSchema();
  const decision = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), 'lib', 'contract-schemas', 'decision.json'),
    'utf8',
  ));
  assert.deepEqual(Object.keys(schema).sort(), Object.keys(decision).sort());
});

test('valid fixture diagram card passes validation', () => {
  const card = loadFixture('valid-card.json');
  const result = validateDiagramCard(card);
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('diagram card missing accessibilityDescription fails validation', () => {
  const card = loadFixture('missing-accessibility-description.json');
  const result = validateDiagramCard(card);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => e.includes('accessibilityDescription')),
    result.errors.join('; '),
  );
});

test('buildDiagramCard marks unknown engine as degraded without throwing', () => {
  const card = buildDiagramCard({
    source: '',
    engine: 'unknown',
    accessibilityDescription: 'placeholder diagram',
    degraded: true,
    reason: 'engine unavailable',
  });
  const result = validateDiagramCard(card);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(card.engine, 'unknown');
  assert.equal(card.engineVersion, null);
  assert.equal(card.degraded, true);
  assert.ok(card.reason);
});

test('describeRendererSelection marks dot fallback as degraded with reason', () => {
  const selection = describeRendererSelection({ d2Binary: null, dotBinary: '/usr/bin/dot' });
  assert.equal(selection.engine, 'dot');
  assert.equal(selection.degraded, true);
  assert.equal(selection.reason, DOT_FALLBACK_REASON);
});

test('describeRendererSelection leaves d2 path non-degraded', () => {
  const selection = describeRendererSelection({ d2Binary: '/usr/bin/d2', dotBinary: '/usr/bin/dot' });
  assert.equal(selection.engine, 'd2');
  assert.equal(selection.degraded, false);
  assert.equal(selection.reason, null);
});

test('describeRendererSelection returns null when no renderer is available', () => {
  assert.equal(describeRendererSelection({ d2Binary: null, dotBinary: null }), null);
});

test('diagramCardToGraphNode produces a contract node and evidenced_by edge', () => {
  const card = loadFixture('valid-card.json');
  assert.ok(NODE_TYPES.has('contract'));
  assert.ok(EDGE_RELS.has('evidenced_by'));
  const { node, edges } = diagramCardToGraphNode(card, { sourceRel: card.source });
  assert.equal(node.type, 'contract');
  assert.equal(node.id, `contract:${card.id}`);
  assert.equal(node.attrs.degraded, true);
  assert.equal(node.attrs.reason, DOT_FALLBACK_REASON);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].rel, 'evidenced_by');
});

test('dot fallback diagram card records degradation state', () => {
  const card = buildDiagramCard({
    id: 'dot-fallback-sample',
    source: '.construct/diagrams/example.dot',
    engine: 'dot',
    engineVersion: 'dot - graphviz version 9.0.0',
    theme: 'neutral',
    seed: null,
    securityProfile: 'sandboxed-subprocess',
    accessibilityDescription: 'architecture diagram: client to api to db',
    provenance: {
      module: 'lib/diagram.mjs',
      command: 'construct diagram client -> api -> db',
      generatedAt: '2026-07-20T20:00:00.000Z',
    },
    degraded: true,
    reason: DOT_FALLBACK_REASON,
    renderedOutput: { path: '.construct/diagrams/example.svg' },
  });
  const result = validateDiagramCard(card);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(card.degraded, true);
  assert.equal(card.reason, DOT_FALLBACK_REASON);
});
