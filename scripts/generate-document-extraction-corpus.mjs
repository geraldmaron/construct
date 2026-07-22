#!/usr/bin/env node
/**
 * scripts/generate-document-extraction-corpus.mjs — build checked-in PDF/DOCX extraction corpus fixtures.
 *
 * Writes tests/fixtures/document-extraction-corpus/ with representative digital
 * PDF, scanned PDF, and DOCX (plain, table, image) files plus manifest.json.
 * Idempotent: re-run after editing fixture definitions to refresh binaries.
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(REPO, 'tests', 'fixtures', 'document-extraction-corpus');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function buildPdfPage(contentStream, resources = '') {
  return `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R${resources}>>endobj
4 0 obj<</Length ${contentStream.length}>>stream
${contentStream}
endstream endobj`;
}

function buildDigitalPdf(pages) {
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ');
  const pageObjects = pages.map((text, i) => {
    const content = `BT /F1 18 Tf 72 700 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
    const pageNum = 5 + i * 2;
    const contentNum = pageNum + 1;
    return `${pageNum} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents ${contentNum} 0 R/Resources<</Font<</F1 99 0 R>>>>>>endobj
${contentNum} 0 obj<</Length ${content.length}>>stream
${content}
endstream endobj`;
  }).join('\n');

  return `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[${kids}]/Count ${pages.length}>>endobj
${pageObjects}
99 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 100>>
%%EOF
`;
}

function writeDocx(target, documentXml, extraParts = []) {
  const root = join(OUT, '.gen-docx');
  mkdirSync(join(root, 'word'), { recursive: true });
  mkdirSync(join(root, '_rels'), { recursive: true });
  mkdirSync(join(root, 'word', '_rels'), { recursive: true });

  writeFileSync(join(root, '[Content_Types].xml'), `<?xml version="1.0"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);

  writeFileSync(join(root, '_rels', '.rels'), `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  writeFileSync(join(root, 'word', 'document.xml'), documentXml);

  for (const part of extraParts) {
    mkdirSync(dirname(join(root, part.path)), { recursive: true });
    writeFileSync(join(root, part.path), part.body);
  }

  const zipArgs = ['-q', '-r', '-X', target, '[Content_Types].xml', '_rels', 'word'];
  execFileSync('zip', zipArgs, { cwd: root });
  rmSync(root, { recursive: true, force: true });
}

mkdirSync(OUT, { recursive: true });

writeFileSync(join(OUT, '01-digital-simple.pdf'), buildDigitalPdf([
  'Construct corpus digital simple PDF sample text for unpdf routing.',
]));

writeFileSync(join(OUT, '02-digital-multipage.pdf'), buildDigitalPdf([
  'Construct corpus multipage digital PDF page one with enough text density for unpdf routing.',
  'Construct corpus multipage digital PDF page two continues the same document body content.',
]));

writeFileSync(join(OUT, '03-digital-sparse.pdf'), buildDigitalPdf([
  'Sparse',
  'Low',
  'Text',
  'Only',
]));

writeFileSync(join(OUT, '04-scanned-empty.pdf'), `%PDF-1.1
1 0 obj<<>>endobj
trailer<<>>
%%EOF
`);

writeDocx(join(OUT, '05-docx-simple.docx'), `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Construct corpus simple DOCX body for mammoth lightweight routing.</w:t></w:r></w:p>
  </w:body>
</w:document>`);

writeDocx(join(OUT, '06-docx-table.docx'), `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Quarterly metrics table fixture.</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Metric</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Value</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Latency ms</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>42</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`);

writeDocx(
  join(OUT, '07-docx-image.docx'),
  `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    <w:p><w:r><w:t>Construct corpus DOCX with embedded image fixture.</w:t></w:r></w:p>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:inline distT="0" distB="0" distL="0" distR="0">
            <wp:extent cx="952500" cy="952500"/>
            <wp:docPr id="1" name="corpus-image"/>
            <a:graphic>
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic>
                  <pic:nvPicPr><pic:cNvPr id="0" name="corpus.png"/><pic:cNvPicPr/></pic:nvPicPr>
                  <pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch/></pic:blipFill>
                  <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
    </w:p>
  </w:body>
</w:document>`,
  [
    {
      path: 'word/_rels/document.xml.rels',
      body: `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/corpus.png"/>
</Relationships>`,
    },
    { path: 'word/media/corpus.png', body: TINY_PNG },
  ],
);

const manifest = {
  schemaVersion: 1,
  generatedBy: 'scripts/generate-document-extraction-corpus.mjs',
  fixtures: [
    {
      id: '01-digital-simple',
      file: '01-digital-simple.pdf',
      format: 'pdf',
      kind: 'digital-text',
      pages: 1,
      expectedRoutingTier: 'lightweight-parser',
      structureSignals: {},
    },
    {
      id: '02-digital-multipage',
      file: '02-digital-multipage.pdf',
      format: 'pdf',
      kind: 'digital-text',
      pages: 2,
      expectedRoutingTier: 'lightweight-parser',
      structureSignals: {},
    },
    {
      id: '03-digital-sparse',
      file: '03-digital-sparse.pdf',
      format: 'pdf',
      kind: 'digital-text-low-density',
      pages: 4,
      expectedRoutingTier: 'docling-local',
      structureSignals: {},
    },
    {
      id: '04-scanned-empty',
      file: '04-scanned-empty.pdf',
      format: 'pdf',
      kind: 'scanned-image',
      pages: 1,
      expectedRoutingTier: 'docling-local',
      structureSignals: {},
    },
    {
      id: '05-docx-simple',
      file: '05-docx-simple.docx',
      format: 'docx',
      kind: 'plain-text',
      expectedRoutingTier: 'lightweight-parser',
      structureSignals: {},
    },
    {
      id: '06-docx-table',
      file: '06-docx-table.docx',
      format: 'docx',
      kind: 'table-structure',
      expectedRoutingTier: 'docling-local',
      structureSignals: { hasTable: true },
    },
    {
      id: '07-docx-image',
      file: '07-docx-image.docx',
      format: 'docx',
      kind: 'embedded-image',
      expectedRoutingTier: 'docling-local',
      structureSignals: { hasEmbeddedImage: true },
    },
  ],
};

writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

writeFileSync(join(OUT, 'README.md'), `# Document extraction corpus

Representative PDF and DOCX fixtures for construct-tsyfe.2.9 routing benchmarks.

Regenerate binaries and manifest with:

\`\`\`bash
node scripts/generate-document-extraction-corpus.mjs
\`\`\`

Fixtures:

- \`01-digital-simple.pdf\` and \`02-digital-multipage.pdf\`: digital-text PDFs for unpdf routing
- \`03-digital-sparse.pdf\` and \`04-scanned-empty.pdf\`: low-yield PDFs that escalate to Docling
- \`05-docx-simple.docx\`: plain DOCX for mammoth routing
- \`06-docx-table.docx\` and \`07-docx-image.docx\`: layout-critical DOCX fixtures

Benchmark entry point: \`lib/document-extract/corpus-benchmark.mjs\`.
Tests: \`tests/document-extraction-corpus-benchmark.test.mjs\`.
`);

console.log(`Wrote document extraction corpus to ${OUT}`);
