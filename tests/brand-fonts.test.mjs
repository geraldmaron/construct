/**
 * tests/brand-fonts.test.mjs — bundled sans paths and PPTX embed contract.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BRAND_SANS_FAMILY,
  BRAND_MONO_FAMILY,
  bundledSansFontPaths,
  bundledMonoFontPaths,
  createPptxGenerator,
} from '../lib/brand-fonts.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('BRAND_SANS_FAMILY is Plus Jakarta Sans', () => {
  assert.equal(BRAND_SANS_FAMILY, 'Plus Jakarta Sans');
});

test('BRAND_MONO_FAMILY is JetBrains Mono', () => {
  assert.equal(BRAND_MONO_FAMILY, 'JetBrains Mono');
});

test('bundledSansFontPaths returns Plus Jakarta Sans TTF cuts', () => {
  const paths = bundledSansFontPaths(REPO);
  assert.equal(paths.length, 4);
  assert.ok(paths.every((p) => p.endsWith('.ttf')));
  assert.ok(paths.some((p) => p.includes('PlusJakartaSans')));
});

test('bundledMonoFontPaths returns three JetBrains Mono TTF cuts', () => {
  const paths = bundledMonoFontPaths(REPO);
  assert.equal(paths.length, 3);
  assert.ok(paths.every((p) => p.endsWith('.ttf')));
});

test('createPptxGenerator returns embed-capable class when pptx-embed-fonts present', () => {
  const { PptxClass, embedFonts } = createPptxGenerator();
  assert.ok(PptxClass);
  assert.equal(typeof embedFonts, 'boolean');
});
