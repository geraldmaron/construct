/**
 * tests/functional/deck-export.functional.test.mjs — branded deck HTML + PPTX export contract.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { exportMarkdown, detect } from '../../lib/document-export.mjs';
import { pptxgenPresent } from '../../lib/deck-export-pptx.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'publish', 'golden-deck-platform.md');
const OUT_DIR = path.join(REPO, '.tmp', 'deck-export-test');

function exportFixture(format, filename) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outputPath = path.join(OUT_DIR, filename);
  const result = exportMarkdown({
    inputPath: FIXTURE,
    outputPath,
    format,
    repoRoot: REPO,
  });
  return { result, outputPath };
}

test('golden-deck-platform fixture exists with slide separators', () => {
  assert.ok(fs.existsSync(FIXTURE));
  const body = fs.readFileSync(FIXTURE, 'utf8');
  assert.match(body, /^---\n/m);
  assert.ok((body.match(/\n---\n/g) || []).length >= 4, 'expected multiple slide breaks');
});

test('exportMarkdown pptx from golden fixture succeeds when pptxgenjs present', () => {
  if (!pptxgenPresent()) {
    const d = detect('pptx', process.env, { repoRoot: REPO });
    assert.equal(d.present, false);
    assert.ok(d.missing.includes('pptxgenjs'));
    return;
  }
  const { result, outputPath } = exportFixture('pptx', 'golden-deck.pptx');
  try {
    assert.equal(result.ok, true, result.message);
    assert.equal(result.slideCount, 6);
    assert.ok(fs.existsSync(outputPath));
    const buf = fs.readFileSync(outputPath);
    assert.ok(buf.length > 5000, 'PPTX should be non-trivial size');
    assert.equal(buf[0], 0x50);
    assert.equal(buf[1], 0x4b);
  } finally {
    try { fs.unlinkSync(outputPath); } catch { /* skip */ }
  }
});

test('exportMarkdown deck html uses Construct brand tokens when pandoc present', () => {
  const d = detect('deck', process.env, { repoRoot: REPO });
  if (!d.present) {
    assert.ok(d.missing.includes('pandoc'));
    return;
  }
  const { result, outputPath } = exportFixture('deck', 'golden-deck.html');
  try {
    assert.equal(result.ok, true, result.message);
    const html = fs.readFileSync(outputPath, 'utf8');
    assert.match(html, /--ink:#0a0c10|var\(--ink\)/);
    assert.match(html, /Plus Jakarta Sans/);
    assert.match(html, /section\.slide|class="slide"/);
  } finally {
    try { fs.unlinkSync(outputPath); } catch { /* skip */ }
  }
});
