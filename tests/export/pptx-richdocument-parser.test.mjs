/**
 * tests/export/pptx-richdocument-parser.test.mjs — PPTX slide blocks via RichDocument IR (construct-tsyfe.6.3).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  slideBlocksFromRichChunk,
  exportDeckPptx,
  pptxgenPresent,
} from '../../lib/deck-export-pptx.mjs';
import { validateExportProviderResult } from '../../lib/export-provider-contract.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'publish', 'golden-deck-platform.md');

test('slideBlocksFromRichChunk parses table, list, and heading blocks from deck fixtures', () => {
  const source = fs.readFileSync(FIXTURE, 'utf8');
  const body = source.replace(/^---[\s\S]*?\n---\n/, '');
  const chunks = body.split(/\n---\n/).map((chunk) => chunk.trim()).filter(Boolean);
  assert.ok(chunks.length >= 5);
  for (const chunk of chunks) {
    const blocks = slideBlocksFromRichChunk(chunk);
    assert.ok(blocks.length >= 1, `chunk produced no blocks: ${chunk.slice(0, 40)}`);
    assert.ok(blocks.some((b) => b.type === 'heading'), `missing heading in ${chunk.slice(0, 40)}`);
  }
  const tableChunk = chunks.find((chunk) => chunk.includes('| Direction |'));
  const tableBlocks = slideBlocksFromRichChunk(tableChunk);
  const table = tableBlocks.find((b) => b.type === 'table');
  assert.ok(table);
  assert.equal(table.headers.length, 2);
  assert.ok(table.rows.length >= 3);
});

test('problem slide chunk includes heading and bullet list', () => {
  const source = fs.readFileSync(FIXTURE, 'utf8');
  const chunks = source.replace(/^---[\s\S]*?\n---\n/, '').split(/\n---\n/).map((c) => c.trim()).filter(Boolean);
  const problem = chunks.find((chunk) => /^## Problem/m.test(chunk));
  assert.ok(problem);
  const blocks = slideBlocksFromRichChunk(problem);
  assert.ok(blocks.some((b) => b.type === 'heading' && /problem/i.test(b.text)));
  const bullets = blocks.find((b) => b.type === 'bullet');
  assert.ok(bullets);
  assert.equal(bullets.items.length, 3);
});

test('exportDeckPptx attaches provider contract evidence when pptxgenjs is present', () => {
  if (!pptxgenPresent()) return;
  const out = path.join(REPO, '.tmp', 'pptx-provider-evidence-test.pptx');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  try {
    const result = exportDeckPptx({ inputPath: FIXTURE, outputPath: out, repoRoot: REPO });
    assert.equal(result.ok, true, result.message);
    const validation = validateExportProviderResult(result);
    assert.equal(validation.ok, true, validation.errors?.join('; '));
    assert.equal(result.provider.name, 'pptxgenjs');
    assert.match(result.contentHash, /^sha256:[a-f0-9]{64}$/);
    assert.ok(result.fidelity && typeof result.fidelity.degraded === 'boolean');
  } finally {
    try { fs.unlinkSync(out); } catch { /* skip */ }
  }
});
