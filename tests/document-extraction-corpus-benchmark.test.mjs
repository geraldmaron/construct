/**
 * tests/document-extraction-corpus-benchmark.test.mjs — corpus benchmark for unpdf/mammoth routing thresholds.
 *
 * construct-tsyfe.2.9: validates the checked-in document-extraction corpus, runs the
 * lightweight-parser benchmark, and asserts calibrated routing thresholds match fixture
 * expectations. Docling comparison is optional via injectable doclingExtract.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CORPUS_DIR,
  loadCorpusManifest,
  runDocumentExtractionCorpusBenchmark,
} from '../lib/document-extract/corpus-benchmark.mjs';
import {
  MIN_TEXT_DENSITY_CHARS_PER_PAGE,
  ROUTING_THRESHOLDS,
} from '../lib/document-extract/routing-thresholds.mjs';
import { extractViaExtractionLadder } from '../lib/document-extract/extraction-ladder.mjs';

async function unpdfPresent() {
  try {
    await import('unpdf');
    return true;
  } catch {
    return false;
  }
}

async function mammothPresent() {
  try {
    await import('mammoth');
    return true;
  } catch {
    return false;
  }
}

test('corpus manifest lists required fixture kinds', () => {
  const manifest = loadCorpusManifest();
  assert.ok(manifest.fixtures.length >= 7);

  const kinds = new Set(manifest.fixtures.map((f) => f.kind));
  assert.ok(kinds.has('digital-text'));
  assert.ok(kinds.has('scanned-image'));
  assert.ok([...kinds].some((k) => k.startsWith('digital-text')));
  assert.ok(kinds.has('plain-text'));
  assert.ok(kinds.has('table-structure'));
  assert.ok(kinds.has('embedded-image'));

  for (const fixture of manifest.fixtures) {
    const path = join(CORPUS_DIR, fixture.file);
    assert.ok(existsSync(path), `missing fixture file ${path}`);
  }
});

test('benchmark produces routing results for every corpus fixture', async (t) => {
  if (!(await unpdfPresent()) && !(await mammothPresent())) {
    t.skip('unpdf/mammoth not installed');
    return;
  }

  const manifest = loadCorpusManifest();
  const simulatedDocling = async (fixturePath) => ({
    text: readFileSync(fixturePath, 'utf8').includes('Construct corpus')
      ? 'Construct corpus simulated docling markdown body'
      : 'Docling OCR body for scanned fixture',
    extractionMethod: 'docling',
  });

  const report = await runDocumentExtractionCorpusBenchmark({ doclingExtract: simulatedDocling });
  assert.equal(report.fixtures.length, manifest.fixtures.length);

  for (const row of report.fixtures) {
    assert.ok(row.routingTier);
    if (row.skipped) continue;
    assert.ok(row.lightweightProvider);
    assert.equal(row.matchesExpected, true, `${row.id} routed to ${row.routingTier}, expected ${row.expectedRoutingTier}`);
    if (row.doclingAvailable) {
      assert.equal(typeof row.fidelityVsDocling, 'number');
    }
  }

  assert.equal(report.thresholds.pdf.minCharsPerPageForLightweight, MIN_TEXT_DENSITY_CHARS_PER_PAGE);
  assert.deepEqual(
    report.recommendations.docx.escalateToDoclingWhenHighFidelityAnd,
    [...ROUTING_THRESHOLDS.docx.escalateToDoclingWhenHighFidelityAnd],
  );
});

test('digital PDF corpus fixtures route through extraction ladder to unpdf', async (t) => {
  if (!(await unpdfPresent())) {
    t.skip('unpdf not installed');
    return;
  }

  const pdfPath = join(CORPUS_DIR, '01-digital-simple.pdf');
  const out = await extractViaExtractionLadder(pdfPath, {
    doclingExtract: async () => { throw new Error('docling must not run for digital corpus PDF'); },
  });
  assert.equal(out.routingTier, 'lightweight-parser');
  assert.equal(out.extractionMethod, 'unpdf');
  assert.match(out.text, /Construct corpus digital simple/);
});

test('scanned PDF corpus fixture escalates to docling-local tier', async () => {
  const pdfPath = join(CORPUS_DIR, '04-scanned-empty.pdf');
  const out = await extractViaExtractionLadder(pdfPath, {
    forceDoclingLocal: true,
    doclingExtract: async () => ({
      text: 'Docling OCR for scanned corpus fixture',
      markdown: 'Docling OCR for scanned corpus fixture',
      droppedInfo: [],
      extractionMethod: 'docling',
    }),
  });
  assert.equal(out.routingTier, 'docling-local');
  assert.equal(out.extractionMethod, 'docling');
});

test('plain DOCX corpus fixture routes to mammoth lightweight tier', async (t) => {
  if (!(await mammothPresent())) {
    t.skip('mammoth not installed');
    return;
  }

  const docxPath = join(CORPUS_DIR, '05-docx-simple.docx');
  const out = await extractViaExtractionLadder(docxPath, {
    doclingExtract: async () => { throw new Error('docling must not run for plain corpus DOCX'); },
  });
  assert.equal(out.routingTier, 'lightweight-parser');
  assert.equal(out.extractionMethod, 'mammoth');
  assert.match(out.text, /Construct corpus simple DOCX/);
});
