/**
 * tests/rich-document-corpus-fidelity.test.mjs — Round-trip fidelity corpus for migrated RichDocument parsers.
 *
 * Reuses fixtures from tests/fixtures/rich-document-corpus/ (authored by construct-tsyfe.3.2).
 * Asserts internal round-trip stability (markdown and HTML pivots) and hostile-HTML sanitization
 * after the unified/remark/rehype adapter migration (construct-tsyfe.3.3).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  markdownToRichDocument, richDocumentToHtml, htmlToRichDocument,
} from '../lib/rich-document.mjs';
import { richDocumentToMarkdown } from '../lib/rich-document-export.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS_DIR = join(REPO, 'tests', 'fixtures', 'rich-document-corpus');

function plainText(doc) {
  const parts = [];
  const walkRuns = (runs) => (runs || []).forEach((r) => parts.push(r.text));
  const walkBlocks = (blocks) => (blocks || []).forEach((b) => {
    if (!b) return;
    if (b.runs) walkRuns(b.runs);
    if (b.items) b.items.forEach((item) => walkBlocks(item));
    if (b.headers) b.headers.forEach((c) => walkRuns(c.runs));
    if (b.rows) b.rows.forEach((row) => row.forEach((c) => walkRuns(c.runs)));
    if (b.caption) walkRuns(b.caption);
    if (b.text) parts.push(b.text);
    if (b.source) parts.push(b.source);
    if (b.blocks) walkBlocks(b.blocks);
  });
  (doc.sections || []).forEach((s) => walkBlocks(s.blocks));
  return parts.join(' ');
}

function tokenize(s) {
  return String(s || '').toLowerCase().replace(/[`*_#>|[\]().!~$-]/g, ' ').split(/\s+/).filter(Boolean);
}

function diceSimilarity(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const ma = new Map();
  ta.forEach((t) => ma.set(t, (ma.get(t) || 0) + 1));
  const mb = new Map();
  tb.forEach((t) => mb.set(t, (mb.get(t) || 0) + 1));
  let inter = 0;
  for (const [t, c] of ma) inter += Math.min(c, mb.get(t) || 0);
  const total = ta.length + tb.length;
  return total === 0 ? 1 : (2 * inter) / total;
}

function blockInventory(doc) {
  const counts = {};
  const walkBlocks = (blocks) => (blocks || []).forEach((b) => {
    if (!b) return;
    counts[b.type] = (counts[b.type] || 0) + 1;
    if (b.items) b.items.forEach((item) => walkBlocks(item));
    if (b.blocks) walkBlocks(b.blocks);
  });
  (doc.sections || []).forEach((s) => walkBlocks(s.blocks));
  return counts;
}

const corpusFiles = readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.md')).sort();

test('corpus fixtures exist', () => {
  assert.ok(corpusFiles.length >= 5, `expected at least 5 corpus fixtures, got ${corpusFiles.length}`);
});

for (const file of corpusFiles) {
  test(`corpus ${file}: markdown round-trip text fidelity >= 99%`, () => {
    const md = readFileSync(join(CORPUS_DIR, file), 'utf8');
    const first = markdownToRichDocument(md);
    const md2 = richDocumentToMarkdown(first);
    const second = markdownToRichDocument(md2);
    const score = diceSimilarity(plainText(first), plainText(second));
    assert.ok(score >= 0.99, `${file} markdown round-trip fidelity ${(score * 100).toFixed(1)}%`);
  });

  test(`corpus ${file}: HTML round-trip text fidelity >= 99%`, () => {
    const md = readFileSync(join(CORPUS_DIR, file), 'utf8');
    const first = markdownToRichDocument(md);
    const html = richDocumentToHtml(first);
    const second = htmlToRichDocument(html);
    const score = diceSimilarity(plainText(first), plainText(second));
    assert.ok(score >= 0.99, `${file} HTML round-trip fidelity ${(score * 100).toFixed(1)}%`);
  });

  test(`corpus ${file}: parses to a valid RichDocument`, () => {
    const md = readFileSync(join(CORPUS_DIR, file), 'utf8');
    const doc = markdownToRichDocument(md);
    assert.ok(doc.sections.length > 0, `${file} produced no sections`);
    assert.ok(Object.keys(blockInventory(doc)).length > 0, `${file} produced no blocks`);
  });
}

test('hostile HTML: javascript href and script tags do not survive htmlToRichDocument round trip', () => {
  const hostile = '<article><section data-cx-level="1"><h1>Title</h1>'
    + '<p>before <script>alert(document.cookie)</script> after</p>'
    + '<p><img src="x" onerror="alert(1)" alt="pic"></p>'
    + '<p><a href="javascript:alert(1)">click</a></p>'
    + '</section></article>';

  const doc = htmlToRichDocument(hostile);
  const out = richDocumentToHtml(doc);

  assert.equal(/<script/i.test(out), false, 'script tag survived round trip');
  assert.equal(/onerror\s*=/i.test(out), false, 'onerror attribute survived round trip');
  assert.equal(/href\s*=\s*"javascript:/i.test(out), false, 'javascript: href survived round trip');
});
