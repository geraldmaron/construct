/**
 * tests/deck-export-pptx.test.mjs — PPTX deck parser and layout helpers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isTitleOnlyChunk, exportDeckPptx, pptxgenPresent } from '../lib/deck-export-pptx.mjs';
import { exportMarkdown } from '../lib/document-export.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'publish', 'golden-deck-platform.md');

test('isTitleOnlyChunk detects duplicate cover slide', () => {
  const chunk = '# Construct Platform Overview\n\nMonochrome ink tagline';
  assert.equal(isTitleOnlyChunk(chunk, { title: 'Construct Platform Overview' }), true);
  assert.equal(isTitleOnlyChunk('## Problem\n\n- item', { title: 'X' }), false);
});

test('exportDeckPptx produces six slides for golden fixture (1 title + 5 content)', () => {
  if (!pptxgenPresent()) return;
  const out = path.join(REPO, '.tmp', 'deck-slide-count-test.pptx');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const result = exportDeckPptx({ inputPath: FIXTURE, outputPath: out });
  try {
    assert.equal(result.ok, true, result.message);
    assert.equal(result.slideCount, 6);
  } finally {
    try { fs.unlinkSync(out); } catch { /* skip */ }
  }
});

test('exportDeckPptx writes non-trivial file with table slide content', () => {
  if (!pptxgenPresent()) return;
  const out = path.join(REPO, '.tmp', 'deck-table-test.pptx');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const result = exportMarkdown({ inputPath: FIXTURE, outputPath: out, format: 'pptx', repoRoot: REPO });
  try {
    assert.equal(result.ok, true, result.message);
    assert.ok(fs.statSync(out).size > 80000);
  } finally {
    try { fs.unlinkSync(out); } catch { /* skip */ }
  }
});
