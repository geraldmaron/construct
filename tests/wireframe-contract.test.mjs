/**
 * tests/wireframe-contract.test.mjs — wireframe no-canvas-engine guardrail (construct-tsyfe.4.7).
 *
 * lib/wireframe.mjs is a semantic-HTML and Mermaid scaffold generator with zero
 * external dependencies. This ratchet blocks canvas or drawing-library imports that
 * would reverse that deliberate design.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildWireframeDiagramCard,
  generateWireframe,
} from '../lib/wireframe.mjs';
import { validateDiagramCard } from '../lib/diagram-card.mjs';

const WIREFRAME_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'wireframe.mjs');

const FORBIDDEN_DRAWING_IMPORTS = [
  /from\s+['"]canvas['"]/,
  /from\s+['"]fabric['"]/,
  /from\s+['"]konva['"]/,
  /from\s+['"]react-konva['"]/,
  /from\s+['"]@excalidraw\/excalidraw['"]/,
  /from\s+['"]paper['"]/,
  /from\s+['"]pixi\.js['"]/,
  /from\s+['"]three['"]/,
  /require\s*\(\s*['"]canvas['"]\s*\)/,
];

export function findForbiddenDrawingImports(source) {
  const hits = [];
  for (const pattern of FORBIDDEN_DRAWING_IMPORTS) {
    if (pattern.test(source)) hits.push(String(pattern));
  }
  return hits;
}

test('lib/wireframe.mjs imports no canvas or drawing libraries', () => {
  const source = fs.readFileSync(WIREFRAME_PATH, 'utf8');
  const hits = findForbiddenDrawingImports(source);
  assert.deepEqual(hits, [], `forbidden drawing imports: ${hits.join(', ')}`);
});

test('guardrail fails when a canvas import is deliberately introduced', () => {
  const source = fs.readFileSync(WIREFRAME_PATH, 'utf8');
  const tampered = `${source}\nimport canvas from 'canvas';\n`;
  const hits = findForbiddenDrawingImports(tampered);
  assert.ok(hits.length > 0, 'tampered source must trip the guardrail');
});

test('wireframe Mermaid output produces a valid Diagram Card', () => {
  const card = buildWireframeDiagramCard({
    description: 'user signup flow',
    type: 'flow',
  });
  assert.ok(card);
  const result = validateDiagramCard(card);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(card.engine, 'mermaid-source-only');
  assert.equal(card.provenance.module, 'lib/wireframe.mjs');
});

test('layout wireframes do not produce Diagram Cards', () => {
  const card = buildWireframeDiagramCard({
    description: 'dashboard with sidebar',
    type: 'layout',
  });
  assert.equal(card, null);
});

test('generateWireframe flow kind returns mermaid format', () => {
  const result = generateWireframe({ description: 'checkout flow', type: 'flow' });
  assert.equal(result.format, 'mermaid');
  assert.equal(result.type, 'flow');
});
