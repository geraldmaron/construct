#!/usr/bin/env node
/**
 * scripts/prototypes/richdocument-unified/run-loadtest.mjs — DISPOSABLE PROTOTYPE.
 * Not imported by lib/ or bin/.
 *
 * Measures parse + full-round-trip wall time and heap delta for the hand-rolled
 * lib/rich-document.mjs pipeline vs. the unified-based prototype (unified-adapter.mjs) at
 * three sizes built by concatenating the real corpus in tests/fixtures/rich-document-corpus/
 * (~83KB combined) 1x/25x/125x, giving ~83KB / ~2MB / ~10.5MB documents — the low end
 * approximates a small bundled export (5 real ADRs concatenated), the high end approximates a
 * large multi-document bundle export (a realistic RichDocument workload for a packed
 * artifact, not a synthetic worst case). Exact byte counts are printed per row.
 *
 * Each size runs N iterations (default 20, fewer for the largest size) and reports median wall
 * time and median heapUsed delta. Heap numbers are indicative, not lab-grade: no --expose-gc
 * forced collection between runs, single process, ordinary V8 GC pressure applies to both
 * pipelines equally since they run back-to-back in the same process.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { markdownToRichDocument, richDocumentToHtml, htmlToRichDocument } from '../../../lib/rich-document.mjs';
import { richDocumentToMarkdown } from '../../../lib/rich-document-export.mjs';
import {
  markdownToRichDocumentUnified, richDocumentToMarkdownUnified,
  richDocumentToHtmlUnified, htmlToRichDocumentUnified,
} from './unified-adapter.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const CORPUS_DIR = path.join(ROOT, 'tests', 'fixtures', 'rich-document-corpus');

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const eq = a.indexOf('=');
    return eq === -1 ? [a.slice(2), 'true'] : [a.slice(2, eq), a.slice(eq + 1)];
  }),
);
const RUNS = Number(args.runs ?? 20);

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function loadCorpusConcat(repeat) {
  const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.md')).sort();
  const bodies = files.map((f) => readFileSync(path.join(CORPUS_DIR, f), 'utf8'));
  const one = bodies.join('\n\n');
  return Array(repeat).fill(one).join('\n\n');
}

function timeAndMemory(fn, runs) {
  const times = [];
  const heapDeltas = [];
  for (let i = 0; i < runs; i += 1) {
    const heapBefore = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    fn();
    const t1 = performance.now();
    const heapAfter = process.memoryUsage().heapUsed;
    times.push(t1 - t0);
    heapDeltas.push(heapAfter - heapBefore);
  }
  return { medianMs: median(times), medianHeapDeltaKb: median(heapDeltas) / 1024 };
}

function handParseFull(md) {
  const rd = markdownToRichDocument(md);
  const md2 = richDocumentToMarkdown(rd);
  const html = richDocumentToHtml(rd);
  const rd2 = htmlToRichDocument(html);
  return rd2;
}

function unifiedParseFull(md) {
  const rd = markdownToRichDocumentUnified(md);
  const md2 = richDocumentToMarkdownUnified(rd);
  const html = richDocumentToHtmlUnified(rd);
  const rd2 = htmlToRichDocumentUnified(html);
  return rd2;
}

function main() {
  const sizes = [
    { label: '1x (small bundle)', repeat: 1, runs: RUNS },
    { label: '25x (medium bundle)', repeat: 25, runs: Math.max(5, Math.floor(RUNS / 2)) },
    { label: '125x (large bundle)', repeat: 125, runs: Math.max(3, Math.floor(RUNS / 5)) },
  ];

  console.log('# RichDocument parser load test — hand-rolled vs. unified/remark/rehype prototype\n');
  console.log('| Size | Bytes | Engine | Median parse+round-trip time (ms) | Median heap delta (KB) | Runs |');
  console.log('|---|---|---|---|---|---|');

  const report = [];
  for (const size of sizes) {
    const md = loadCorpusConcat(size.repeat);
    const bytes = Buffer.byteLength(md, 'utf8');

    // Warm up each pipeline once so JIT/lazy module init isn't charged to the first measured run.
    handParseFull(md);
    unifiedParseFull(md);

    const hand = timeAndMemory(() => handParseFull(md), size.runs);
    const unifiedRes = timeAndMemory(() => unifiedParseFull(md), size.runs);

    console.log(`| ${size.label} | ${bytes} | hand-rolled | ${hand.medianMs.toFixed(2)} | ${hand.medianHeapDeltaKb.toFixed(1)} | ${size.runs} |`);
    console.log(`| ${size.label} | ${bytes} | unified | ${unifiedRes.medianMs.toFixed(2)} | ${unifiedRes.medianHeapDeltaKb.toFixed(1)} | ${size.runs} |`);

    report.push({ size: size.label, bytes, hand, unified: unifiedRes });
  }

  console.log('\n(Full JSON below for the decision record.)\n');
  console.log(JSON.stringify(report, null, 2));
}

main();
