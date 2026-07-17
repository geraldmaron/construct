#!/usr/bin/env node
/**
 * scripts/prototypes/richdocument-unified/run-fidelity.mjs — DISPOSABLE PROTOTYPE
 * (construct-tsyfe.3.2). Not imported by lib/ or bin/. See this directory's README.md.
 *
 * Round-trips every fixture in tests/fixtures/rich-document-corpus/ through the hand-rolled
 * lib/rich-document.mjs pipeline and the unified-based prototype pipeline
 * (unified-adapter.mjs), for both markdown -> RichDocument -> markdown -> RichDocument and
 * HTML -> RichDocument -> HTML -> RichDocument, and reports:
 *   1. block-type inventory per engine (do the two engines agree on document structure?)
 *   2. markdown round-trip text-fidelity score (parse -> serialize -> re-parse stability)
 *   3. HTML round-trip text-fidelity score (same, via the HTML pivot)
 *   4. a hostile-HTML sanitization probe (does raw <script>/on*= survive htmlToRichDocument?)
 *
 * Text-fidelity is a token-level Dice coefficient over whitespace/markdown-punctuation-
 * stripped, lowercased tokens extracted from every Run/cell/code/diagram text field in the
 * RichDocument tree — a coarse but reproducible proxy for "did the visible text survive,"
 * not a claim of semantic equivalence.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { markdownToRichDocument, richDocumentToHtml, htmlToRichDocument } from '../../../lib/rich-document.mjs';
import { richDocumentToMarkdown } from '../../../lib/rich-document-export.mjs';
import {
  markdownToRichDocumentUnified, richDocumentToMarkdownUnified,
  richDocumentToHtmlUnified, htmlToRichDocumentUnified,
} from './unified-adapter.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const CORPUS_DIR = path.join(ROOT, 'tests', 'fixtures', 'rich-document-corpus');

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

function inventoryDiffKeys(a, b) {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
}

function fmtPct(n) { return `${(n * 100).toFixed(1)}%`; }

function runFixture(name, md) {
  // Hand-rolled: md -> RD -> md -> RD (round-trip stability), and md -> RD -> html -> RD.
  const rdA = markdownToRichDocument(md);
  const mdA2 = richDocumentToMarkdown(rdA);
  const rdA2 = markdownToRichDocument(mdA2);
  const htmlA = richDocumentToHtml(rdA);
  const rdA3 = htmlToRichDocument(htmlA);

  // Unified: same shape, unified engine.
  const rdB = markdownToRichDocumentUnified(md);
  const mdB2 = richDocumentToMarkdownUnified(rdB);
  const rdB2 = markdownToRichDocumentUnified(mdB2);
  const htmlB = richDocumentToHtmlUnified(rdB);
  const rdB3 = htmlToRichDocumentUnified(htmlB);

  const mdRoundTripFidelityA = diceSimilarity(plainText(rdA), plainText(rdA2));
  const mdRoundTripFidelityB = diceSimilarity(plainText(rdB), plainText(rdB2));
  const htmlRoundTripFidelityA = diceSimilarity(plainText(rdA), plainText(rdA3));
  const htmlRoundTripFidelityB = diceSimilarity(plainText(rdB), plainText(rdB3));
  const crossEngineTextAgreement = diceSimilarity(plainText(rdA), plainText(rdB));

  const invA = blockInventory(rdA);
  const invB = blockInventory(rdB);

  return {
    name,
    mdRoundTripFidelityA, mdRoundTripFidelityB,
    htmlRoundTripFidelityA, htmlRoundTripFidelityB,
    crossEngineTextAgreement,
    invA, invB,
  };
}

function hostileHtmlProbe() {
  const hostile = '<article><section data-cx-level="1"><h1>Title</h1>'
    + '<p>before <script>alert(document.cookie)</script> after</p>'
    + '<p><img src="x" onerror="alert(1)" alt="pic"></p>'
    + '<p><a href="javascript:alert(1)">click</a></p>'
    + '</section></article>';

  const rdHand = htmlToRichDocument(hostile);
  const handOut = richDocumentToHtml(rdHand);
  const rdUnified = htmlToRichDocumentUnified(hostile);
  const unifiedOut = richDocumentToHtmlUnified(rdUnified);

  const check = (html) => ({
    scriptTagSurvived: /<script/i.test(html),
    onerrorSurvived: /onerror\s*=/i.test(html),
    javascriptHrefSurvived: /href\s*=\s*"javascript:/i.test(html),
  });

  return { hand: check(handOut), unified: check(unifiedOut) };
}

function main() {
  const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.md')).sort();
  const results = files.map((f) => runFixture(f, readFileSync(path.join(CORPUS_DIR, f), 'utf8')));

  console.log('# RichDocument parser fidelity — hand-rolled vs. unified/remark/rehype prototype\n');
  console.log(`Corpus: ${files.length} fixtures from tests/fixtures/rich-document-corpus/\n`);

  console.log('## Round-trip text fidelity (Dice token similarity, 1.0 = perfectly stable)\n');
  console.log('| Fixture | MD round-trip (hand) | MD round-trip (unified) | HTML round-trip (hand) | HTML round-trip (unified) | Cross-engine text agreement |');
  console.log('|---|---|---|---|---|---|');
  for (const r of results) {
    console.log(`| ${r.name} | ${fmtPct(r.mdRoundTripFidelityA)} | ${fmtPct(r.mdRoundTripFidelityB)} | ${fmtPct(r.htmlRoundTripFidelityA)} | ${fmtPct(r.htmlRoundTripFidelityB)} | ${fmtPct(r.crossEngineTextAgreement)} |`);
  }

  console.log('\n## Block-type inventory per fixture (hand-rolled vs. unified, parsing the same original markdown)\n');
  for (const r of results) {
    const keys = inventoryDiffKeys(r.invA, r.invB);
    const rowStr = keys.map((k) => `${k}: ${r.invA[k] || 0}/${r.invB[k] || 0}`).join(', ');
    console.log(`- **${r.name}** — ${rowStr}`);
  }

  console.log('\n## Hostile-HTML sanitization probe (script tag, onerror attr, javascript: href)\n');
  const probe = hostileHtmlProbe();
  console.log('| Engine | `<script>` survives round trip | `onerror=` survives | `javascript:` href survives |');
  console.log('|---|---|---|---|');
  console.log(`| Hand-rolled (parseHtmlTree, no sanitize) | ${probe.hand.scriptTagSurvived} | ${probe.hand.onerrorSurvived} | ${probe.hand.javascriptHrefSurvived} |`);
  console.log(`| Unified (rehype-parse + rehype-sanitize) | ${probe.unified.scriptTagSurvived} | ${probe.unified.onerrorSurvived} | ${probe.unified.javascriptHrefSurvived} |`);

  console.log('\n(Full JSON below for the decision record.)\n');
  console.log(JSON.stringify({ results, hostileHtmlProbe: probe }, null, 2));
}

main();
