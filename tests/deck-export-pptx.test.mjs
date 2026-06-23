/**
 * tests/deck-export-pptx.test.mjs — PPTX deck parser and layout helpers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isTitleOnlyChunk, exportDeckPptx, pptxgenPresent, auditDeckMarkdownLayout, auditPptxFile, readPptxSlideSizeIn, SLIDE_CONTENT_BUDGET_IN, SLIDE_W_IN, SLIDE_H_IN } from '../lib/deck-export-pptx.mjs';
import { exportMarkdown } from '../lib/document-export.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'publish', 'golden-deck-platform.md');

test('golden deck passes pre-export layout audit within slide budget', () => {
  const body = fs.readFileSync(FIXTURE, 'utf8');
  const audit = auditDeckMarkdownLayout(body, { title: 'Construct Platform Overview' });
  assert.equal(audit.ok, true, JSON.stringify(audit.issues, null, 2));
  assert.ok(audit.slides.length >= 5);
  for (const slide of audit.slides) {
    assert.ok(slide.estimatedHeightIn <= SLIDE_CONTENT_BUDGET_IN + 0.1, `slide ${slide.slideIndex} height ${slide.estimatedHeightIn}`);
  }
});

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
    const size = readPptxSlideSizeIn(out);
    assert.equal(size.w, SLIDE_W_IN);
    assert.equal(size.h, SLIDE_H_IN);
    const bounds = auditPptxFile(out);
    assert.equal(bounds.ok, true, JSON.stringify(bounds.issues, null, 2));
  } finally {
    try { fs.unlinkSync(out); } catch { /* skip */ }
  }
});

// Regression: the pre-export estimate must match the render closely enough that a
// table taller than the content band is rejected, not silently shipped bleeding.

test('oversized table is rejected by the pre-export audit (fail-closed)', () => {
  let md = '# Big\n\n---\n\n## Overflowing table\n\n| Col A | Col B |\n|--|--|\n';
  for (let i = 0; i < 14; i += 1) {
    md += `| Row ${i} label text here | A fairly long cell value that wraps onto multiple lines ${i} |\n`;
  }
  const audit = auditDeckMarkdownLayout(md, { title: 'Big' });
  assert.equal(audit.ok, false);
  assert.ok(audit.issues.some((i) => i.code === 'vertical_overflow'), JSON.stringify(audit.issues));
});

test('compact table plus trailing paragraphs fits the slide budget', () => {
  const md = [
    '# Doc deck', '', '---', '', '## Document I/O at a glance', '',
    '| Direction | Formats |', '|--|--|',
    '| **Ingest** | PDF, Office, email, AV |',
    '| **Author** | Typed markdown artifacts |',
    '| **Export** | PDF, DOCX, HTML, PPTX |', '',
    'High fidelity ingest uses the docling Python sidecar (local-first).', '',
    'Fast tier uses unpdf/mammoth.', '',
  ].join('\n');
  const audit = auditDeckMarkdownLayout(md, { title: 'Doc deck' });
  assert.equal(audit.ok, true, JSON.stringify(audit.issues, null, 2));
  for (const slide of audit.slides) {
    assert.ok(slide.estimatedHeightIn <= SLIDE_CONTENT_BUDGET_IN, `slide ${slide.slideIndex} height ${slide.estimatedHeightIn}`);
  }

  if (!pptxgenPresent()) return;
  const out = path.join(REPO, '.tmp', 'deck-compact-fit-test.pptx');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const src = path.join(REPO, '.tmp', 'deck-compact-fit-src.md');
  fs.writeFileSync(src, md);
  try {
    const result = exportMarkdown({ inputPath: src, outputPath: out, format: 'pptx', repoRoot: REPO });
    assert.equal(result.ok, true, result.message);
    const bounds = auditPptxFile(out);
    assert.equal(bounds.ok, true, JSON.stringify(bounds.issues, null, 2));
  } finally {
    try { fs.unlinkSync(out); } catch { /* skip */ }
    try { fs.unlinkSync(src); } catch { /* skip */ }
  }
});
