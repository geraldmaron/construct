/**
 * tests/functional/extraction-ladder.functional.test.mjs
 *
 * construct-tsyfe.2.2: quality-aware extraction ladder routes digital PDF to
 * unpdf, scanned/image PDF to Docling, DOCX to mammoth, and unsupported formats
 * to an explicit manual-recovery state. Injectable extractors keep the suite
 * hermetic (no real docling venv).
 *
 * @capability document-type.ingested-markdown
 * @capability ingest.adapter
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractViaExtractionLadder, isDigitalTextPdf } from '../../lib/document-extract/extraction-ladder.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const DIGITAL_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 52>>stream
BT /F1 24 Tf 72 700 Td (Hello Construct ladder digital) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF
`;

const SCANNED_PDF = `%PDF-1.1
1 0 obj<<>>endobj
trailer<<>>
%%EOF
`;

async function depsPresent() {
  try { await import('unpdf'); await import('mammoth'); return true; }
  catch { return false; }
}

function writeDocx(dir, target) {
  const root = join(dir, 'docx-src');
  mkdirSync(join(root, 'word'), { recursive: true });
  mkdirSync(join(root, '_rels'), { recursive: true });
  writeFileSync(join(root, '[Content_Types].xml'), '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  writeFileSync(join(root, '_rels', '.rels'), '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  writeFileSync(join(root, 'word', 'document.xml'), '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Ladder mammoth docx sample</w:t></w:r></w:p></w:body></w:document>');
  execFileSync('zip', ['-q', '-r', '-X', target, '[Content_Types].xml', '_rels', 'word'], { cwd: root });
}

test('isDigitalTextPdf accepts non-empty unpdf text and rejects empty scanned yield', () => {
  assert.equal(isDigitalTextPdf({ text: 'Hello Construct ladder digital', pageCount: 1, charsPerPage: 30 }), true);
  assert.equal(isDigitalTextPdf({ text: 'x'.repeat(120), pageCount: 2, charsPerPage: 60 }), true);
  assert.equal(isDigitalTextPdf({ text: 'short', pageCount: 4, charsPerPage: 1 }), false);
  assert.equal(isDigitalTextPdf({ text: '', pageCount: 1, charsPerPage: 0 }), false);
});

test('digital PDF routes to unpdf lightweight tier', async (t) => {
  if (!(await depsPresent())) { t.skip('unpdf not installed'); return; }

  const dir = mkdtempSync(join(tmpdir(), 'cx-ladder-digital-'));
  const pdfPath = join(dir, 'digital.pdf');
  writeFileSync(pdfPath, DIGITAL_PDF);
  try {
    const out = await extractViaExtractionLadder(pdfPath, {
      doclingExtract: async () => { throw new Error('docling must not run for digital PDF'); },
    });
    assert.equal(out.routingTier, 'lightweight-parser');
    assert.equal(out.extractionMethod, 'unpdf');
    assert.match(out.text, /Hello Construct ladder digital/);
  } finally {
    rmTmpDir(dir);
  }
});

test('scanned PDF routes to docling-local tier when lightweight yield is low', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-ladder-scanned-'));
  const pdfPath = join(dir, 'scanned.pdf');
  writeFileSync(pdfPath, SCANNED_PDF);
  try {
    const out = await extractViaExtractionLadder(pdfPath, {
      forceDoclingLocal: true,
      doclingExtract: async () => ({
        text: 'OCR markdown body',
        markdown: 'OCR markdown body',
        droppedInfo: [],
        extractionMethod: 'docling',
      }),
    });
    assert.equal(out.routingTier, 'docling-local');
    assert.equal(out.extractionMethod, 'docling');
    assert.match(out.text, /OCR markdown body/);
  } finally {
    rmTmpDir(dir);
  }
});

test('DOCX routes to mammoth lightweight tier', async (t) => {
  if (!(await depsPresent())) { t.skip('mammoth not installed'); return; }

  const dir = mkdtempSync(join(tmpdir(), 'cx-ladder-docx-'));
  const docxPath = join(dir, 'sample.docx');
  writeDocx(dir, docxPath);
  try {
    const out = await extractViaExtractionLadder(docxPath, {
      doclingExtract: async () => { throw new Error('docling must not run for simple DOCX'); },
    });
    assert.equal(out.routingTier, 'lightweight-parser');
    assert.equal(out.extractionMethod, 'mammoth');
    assert.match(out.text, /Ladder mammoth docx sample/);
  } finally {
    rmTmpDir(dir);
  }
});

test('formats without a matching tier return unsupported manual-recovery state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-ladder-unsupported-'));
  const xlsxPath = join(dir, 'sheet.xlsx');
  writeFileSync(xlsxPath, 'not-a-real-xlsx');
  try {
    const out = await extractViaExtractionLadder(xlsxPath, {
      doclingExtract: null,
      doclingRemoteExtract: null,
    });
    assert.equal(out.routingTier, 'unsupported');
    assert.equal(out.extractionMethod, 'unsupported');
    assert.equal(out.unsupported, true);
    assert.equal(out.manualRecovery, true);
    assert.ok(out.remediation);
  } finally {
    rmTmpDir(dir);
  }
});

test('ingest adapter path records routingTier and extractionMethod in durable output', async (t) => {
  if (!(await depsPresent())) { t.skip('unpdf/mammoth not installed'); return; }

  const dir = mkdtempSync(join(tmpdir(), 'cx-ladder-ingest-'));
  mkdirSync(join(dir, '.construct'), { recursive: true });
  writeFileSync(join(dir, '.construct', 'construct.config.json'), '{}\n');
  const pdfPath = join(dir, 'digital.pdf');
  writeFileSync(pdfPath, DIGITAL_PDF);
  try {
    const { ingestDocuments } = await import('../../lib/document-ingest.mjs');
    const result = await ingestDocuments([pdfPath], {
      cwd: dir,
      target: 'sibling',
      highFidelity: true,
      env: { ...process.env, CONSTRUCT_INGEST_STRATEGY: 'adapter' },
    });
    assert.equal(result.status, 'ok');
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].routingTier, 'lightweight-parser');
    assert.equal(result.files[0].extractionMethod, 'unpdf');
    assert.match(result.files[0].outputPath, /\.md$/);
  } finally {
    rmTmpDir(dir);
  }
});
