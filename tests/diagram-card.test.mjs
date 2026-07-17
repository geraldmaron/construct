/**
 * tests/diagram-card.test.mjs — Diagram Card schema validation, degraded-build
 * behavior, and graph-node projection (construct-tsyfe.4.1).
 *
 * @capability test-system.diagram-card
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  DIAGRAM_CARD_TYPE,
  buildDiagramCard,
  diagramCardToGraphNode,
  validateDiagramCard,
} from '../lib/diagram-card.mjs';
import { NODE_TYPES } from '../lib/graph/store.mjs';

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'diagram-card');

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

test('a well-formed Diagram Card validates with no errors', () => {
  const card = readFixture('valid-card.json');
  const result = validateDiagramCard(card);
  assert.equal(result.valid, true, result.errors.join('; '));
  assert.deepEqual(result.errors, []);
});

test('a Diagram Card missing accessibilityDescription fails validation naming the field', () => {
  const card = readFixture('missing-accessibility-description.json');
  const result = validateDiagramCard(card);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.includes('accessibilityDescription')),
    `expected an accessibilityDescription error, got: ${result.errors.join('; ')}`
  );
});

test('a Diagram Card missing other required fields is rejected by name', () => {
  const result = validateDiagramCard({ type: DIAGRAM_CARD_TYPE });
  assert.equal(result.valid, false);
  for (const field of ['id required', 'source required', 'engine invalid', 'securityProfile required', 'provenance required']) {
    assert.ok(result.errors.some((error) => error.includes(field)), `expected error containing '${field}', got: ${result.errors.join('; ')}`);
  }
});

test('accessibilityDescription and provenance.command must be plain text, not markdown/HTML', () => {
  const card = readFixture('valid-card.json');
  const withMarkup = { ...card, accessibilityDescription: 'Click <a href="javascript:alert(1)">here</a>' };
  const result = validateDiagramCard(withMarkup);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('accessibilityDescription')));
});

test('buildDiagramCard never throws and degrades honestly when engine is absent/unreachable', () => {
  const card = buildDiagramCard({
    id: 'diagram-card:no-engine',
    source: 'flowchart TD\n  A --> B',
    engine: undefined,
    securityProfile: 'sandboxed-subprocess',
    accessibilityDescription: 'A depends on B.',
    provenance: { module: 'lib/diagram.mjs' },
  });
  assert.equal(card.engine, 'unknown');
  assert.equal(card.engineVersion, null);
  assert.equal(card.degraded, true);
  assert.ok(typeof card.reason === 'string' && card.reason.length > 0, 'reason must be a non-empty string');
  const result = validateDiagramCard(card);
  assert.equal(result.valid, true, result.errors.join('; '));
});

test('buildDiagramCard forces engineVersion null and is not degraded for a deliberate source-only render', () => {
  const card = buildDiagramCard({
    id: 'diagram-card:source-only',
    source: 'flowchart TD\n  A --> B',
    engine: 'mermaid-source-only',
    engineVersion: '11.16.0',
    securityProfile: 'browser-innerHTML-loose',
    accessibilityDescription: 'A depends on B.',
    provenance: { module: 'lib/diagram.mjs' },
  });
  assert.equal(card.engineVersion, null);
  assert.equal(card.degraded, false);
  assert.equal(card.reason, null);
});

test('buildDiagramCard never omits securityProfile or accessibilityDescription when the caller supplies neither', () => {
  const card = buildDiagramCard({ id: 'diagram-card:bare', source: 'x --> y', engine: 'd2', engineVersion: '0.6.0' });
  assert.equal(card.degraded, true);
  assert.ok(card.securityProfile.length > 0);
  assert.ok(card.accessibilityDescription.length > 0);
  assert.ok(card.reason.includes('securityProfile'));
  assert.ok(card.reason.includes('accessibilityDescription'));
});

test('diagramCardToGraphNode produces a contract node type present in NODE_TYPES', () => {
  const card = readFixture('valid-card.json');
  const { node, edges } = diagramCardToGraphNode(card, { sourceFilePath: 'docs/architecture.md' });
  assert.equal(node.type, 'contract');
  assert.ok(NODE_TYPES.has(node.type));
  assert.equal(node.id, `contract:${card.id}`);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].rel, 'evidenced_by');
  assert.equal(edges[0].from, node.id);
  assert.equal(edges[0].to, 'file:docs/architecture.md');
});

test('diagramCardToGraphNode refuses to project an invalid Card', () => {
  const card = readFixture('missing-accessibility-description.json');
  assert.throws(() => diagramCardToGraphNode(card), /fails validation/);
});
