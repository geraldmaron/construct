/**
 * tests/asset-quality/brand-contrast.test.mjs — Guards brand legibility and the spacing scale.
 *
 * The contrast math is checked against a known anchor (black on white is 21:1), the load-bearing
 * text palette is held to WCAG AA, and ink.faint is guarded as a decorative color that must stay
 * out of the text set. The spacing scale is the single ordered rhythm consumers derive from.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contrastRatio,
  meetsWcagAA,
  validateBrandContrast,
  BRAND_TEXT_PAIRS,
  AA_BODY,
} from '../../lib/brand-contrast.mjs';
import { BRAND_TOKENS, SPACING_SCALE } from '../../lib/brand-tokens.mjs';

test('contrast math matches the WCAG anchor and AA thresholds', () => {
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21);
  assert.equal(contrastRatio('#ffffff', '#ffffff'), 1);
  assert.equal(meetsWcagAA(4.5), true);
  assert.equal(meetsWcagAA(4.49), false);
  assert.equal(meetsWcagAA(3.0, { large: true }), true);
});

test('the load-bearing brand text palette meets WCAG AA', () => {
  const result = validateBrandContrast();
  assert.equal(result.ok, true, `failing pairs: ${result.failures.map((f) => `${f.label} (${f.ratio})`).join(', ')}`);
  assert.ok(BRAND_TEXT_PAIRS.length >= 5);
  for (const entry of result.results) assert.ok(entry.ratio >= AA_BODY);
});

test('ink.faint stays a decorative color, below AA, and out of the text set', () => {
  const faintRatio = contrastRatio(BRAND_TOKENS.ink.faint, BRAND_TOKENS.surface.paper);
  assert.ok(faintRatio < AA_BODY);
  assert.ok(!BRAND_TEXT_PAIRS.some((pair) => pair.fg === BRAND_TOKENS.ink.faint));
});

test('the spacing scale is a single ordered rhythm', () => {
  const values = Object.values(SPACING_SCALE);
  for (let i = 1; i < values.length; i++) {
    assert.ok(values[i] > values[i - 1], 'spacing scale must be strictly increasing');
  }
  assert.equal(SPACING_SCALE.md, 1);
});
