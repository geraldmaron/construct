/**
 * tests/functional/node-native-extraction.functional.test.mjs
 *
 * Bead construct-ij31.20: the default adapter ingest path extracts plain PDF and
 * DOCX through the Node-native optional deps (unpdf, mammoth) with NO Python venv
 * and NO system extraction binary on PATH. Builds minimal real fixtures, scrubs
 * PATH so pdftotext/textutil/unzip cannot satisfy the extraction, and asserts the
 * Node-native backend produced the text. Skips only if the optional deps are
 * genuinely absent from the install.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractDocumentTextNodeNative } from '../../lib/document-extract.mjs';

async function depsPresent() {
  try { await import('unpdf'); await import('mammoth'); return true; }
  catch { return false; }
}

const MIN_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 52>>stream
BT /F1 24 Tf 72 700 Td (Hello Construct Node native) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF
`;

function writeDocx(dir, target) {
  const root = join(dir, 'docx-src');
  mkdirSync(join(root, 'word'), { recursive: true });
  mkdirSync(join(root, '_rels'), { recursive: true });
  writeFileSync(join(root, '[Content_Types].xml'), '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  writeFileSync(join(root, '_rels', '.rels'), '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  writeFileSync(join(root, 'word', 'document.xml'), '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Mammoth docx text sample</w:t></w:r></w:p></w:body></w:document>');
  execFileSync('zip', ['-q', '-r', '-X', target, '[Content_Types].xml', '_rels', 'word'], { cwd: root });
}

test('node-native adapter extracts PDF and DOCX with no Python or system binary', async (t) => {
  if (!(await depsPresent())) { t.skip('unpdf/mammoth not installed'); return; }

  const dir = mkdtempSync(join(tmpdir(), 'cx-node-extract-'));
  const pdfPath = join(dir, 'sample.pdf');
  const docxPath = join(dir, 'sample.docx');
  writeFileSync(pdfPath, MIN_PDF);
  writeDocx(dir, docxPath);

  // Scrub PATH so no system extractor (pdftotext, textutil, mdls, unzip) can run;
  // only the in-process Node-native backend can satisfy extraction.
  const realPath = process.env.PATH;
  process.env.PATH = '';
  try {
    const pdf = await extractDocumentTextNodeNative(pdfPath);
    assert.equal(pdf.extractionMethod, 'unpdf', `expected unpdf backend, got ${pdf.extractionMethod}`);
    assert.match(pdf.text, /Hello Construct Node native/);

    const docx = await extractDocumentTextNodeNative(docxPath);
    assert.equal(docx.extractionMethod, 'mammoth', `expected mammoth backend, got ${docx.extractionMethod}`);
    assert.match(docx.text, /Mammoth docx text sample/);
  } finally {
    process.env.PATH = realPath;
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
