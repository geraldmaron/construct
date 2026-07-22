/**
 * tests/document-extract/docling-structured-export.test.mjs — Docling structured dict export (construct-tsyfe.2.3).
 *
 * Asserts sidecar structuredDict round-trip, RichDocument normalization with table blocks,
 * and ingest persistence of raw provider + normalized RichDocument sidecars.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildRichDocumentFromDoclingDict,
  collectTableBlocks,
  enrichDoclingSidecarResult,
} from '../../lib/document-extract/docling-rich-document.mjs';
import {
  configureDoclingClientForTests,
  resetDoclingSidecarForTests,
  extractViaDocling,
} from '../../lib/document-extract/docling-client.mjs';
import { writeIngestExtractionSidecars } from '../../lib/document-ingest.mjs';
import { validateRichDocument } from '../../lib/rich-document.mjs';
import { DOCLING_PIN } from '../../lib/runtime/uv-bootstrap.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE_DICT = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'tests/fixtures/docling-structured/table-fixture-dict.json'), 'utf8'),
);
const STUB_SCRIPT = path.join(repoRoot, 'tests/functional/fixtures/docling-sidecar-stub-fixture.mjs');

const tmpDirs = [];
test.afterEach(async () => { await resetDoclingSidecarForTests(); });
test.after(() => { for (const dir of tmpDirs) rmTmpDir(dir); });

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

test('buildRichDocumentFromDoclingDict preserves table blocks from docling dict', () => {
  const richDoc = buildRichDocumentFromDoclingDict(FIXTURE_DICT, { title: 'table-fixture' });
  assert.ok(richDoc);
  assert.equal(validateRichDocument(richDoc).ok, true);
  const tables = collectTableBlocks(richDoc);
  assert.ok(tables.length > 0, 'expected non-empty table blocks');
  assert.equal(tables[0].headers[0].runs[0].text, 'Metric');
  assert.equal(tables[0].rows[0][1].runs[0].text, '42');
});

test('enrichDoclingSidecarResult attaches structured RichDocument and providerRepresentation', () => {
  const enriched = enrichDoclingSidecarResult({
    markdown: '# sample',
    metadata: { doclingVersion: DOCLING_PIN },
    structuredDict: FIXTURE_DICT,
    droppedInfo: [],
  }, { title: 'table-fixture' });

  assert.ok(enriched.providerRepresentation);
  assert.ok(enriched.structured);
  assert.ok(collectTableBlocks(enriched.structured).length > 0);
});

test('extractViaDocling returns structuredDict from stub sidecar', async () => {
  const root = tmpDir('docling-structured-');
  const filePath = path.join(root, 'table.pdf');
  fs.writeFileSync(filePath, '%PDF-1.1 stub');

  process.env.STUB_STRUCTURED_DICT = '1';
  configureDoclingClientForTests({
    pythonBin: process.execPath,
    scriptPath: STUB_SCRIPT,
    maxConcurrency: 1,
    maxQueueSize: 4,
    requestTimeoutMs: 10_000,
    pinnedVersion: DOCLING_PIN,
  });

  const out = await extractViaDocling(filePath);
  assert.ok(out.structuredDict);
  assert.ok(Array.isArray(out.structuredDict.tables));
  assert.ok(out.structuredDict.tables.length > 0);
});

test('writeIngestExtractionSidecars persists provider and rich artifacts', () => {
  const root = tmpDir('docling-sidecars-');
  const outputPath = path.join(root, 'metrics.pdf.md');
  const extracted = enrichDoclingSidecarResult({
    markdown: '# metrics',
    metadata: { doclingVersion: DOCLING_PIN },
    structuredDict: FIXTURE_DICT,
    droppedInfo: [],
  }, { title: 'metrics' });

  const { providerArtifactPath, richArtifactPath } = writeIngestExtractionSidecars({
    richDoc: extracted.structured,
    extracted,
    assetBaseDir: root,
    outputPath,
  });

  assert.ok(providerArtifactPath);
  assert.ok(richArtifactPath);
  assert.ok(fs.existsSync(providerArtifactPath));
  assert.ok(fs.existsSync(richArtifactPath));

  const raw = JSON.parse(fs.readFileSync(providerArtifactPath, 'utf8'));
  assert.ok(Array.isArray(raw.tables));
  assert.ok(raw.tables.length > 0);

  const rich = JSON.parse(fs.readFileSync(richArtifactPath, 'utf8'));
  assert.ok(collectTableBlocks(rich).length > 0);
});
