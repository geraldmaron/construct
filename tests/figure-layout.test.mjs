/**
 * tests/figure-layout.test.mjs — SVG label overlap proof for publish figures.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  assessSvgTextOverlap,
  assertSvgLabelsDoNotOverlap,
  extractSvgTextBoxes,
} from '../lib/figure-layout.mjs';

test('extractSvgTextBoxes reads positioned labels', () => {
  const svg = `<svg><text x="10" y="20" font-size="12">Alpha</text><text x="100" y="20" font-size="12">Beta</text></svg>`;
  const boxes = extractSvgTextBoxes(svg);
  assert.equal(boxes.length, 2);
  assert.equal(boxes[0].text, 'Alpha');
  assert.equal(boxes[1].text, 'Beta');
});

test('assessSvgTextOverlap passes separated labels', () => {
  const svg = `<svg><text x="10" y="20" font-size="12">Alpha</text><text x="200" y="20" font-size="12">Beta</text></svg>`;
  const result = assessSvgTextOverlap(svg);
  assert.equal(result.ok, true);
  assert.equal(result.overlaps.length, 0);
});

test('assessSvgTextOverlap fails colliding labels', () => {
  const svg = `<svg><text x="10" y="20" font-size="14">LongLabelOne</text><text x="18" y="22" font-size="14">LongLabelTwo</text></svg>`;
  const result = assessSvgTextOverlap(svg);
  assert.equal(result.ok, false);
  assert.ok(result.overlaps.length >= 1);
  assert.throws(() => assertSvgLabelsDoNotOverlap(svg, { label: 'fixture' }), /overlap/);
});

test('vessel D2 fixture SVG has no overlapping labels', () => {
  const svg = fs.readFileSync(new URL('./fixtures/figure-layout/vessel.svg', import.meta.url), 'utf8');
  assertSvgLabelsDoNotOverlap(svg, { label: 'vessel', pad: 2 });
});

test('overlap-bad fixture is detected', () => {
  const svg = fs.readFileSync(new URL('./fixtures/figure-layout/overlap-bad.svg', import.meta.url), 'utf8');
  const result = assessSvgTextOverlap(svg);
  assert.equal(result.ok, false);
});
