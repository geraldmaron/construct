/**
 * tests/functional/richdoc-ingest-write.functional.test.mjs — ingest write path uses one
 * RichDocument instance for markdown output and asset manifest (construct-tsyfe.3.4).
 *
 * Exercises real ingestDocuments() on a plain-text fixture and the exported ingest write
 * helpers for embedded-image externalization, asserting the written markdown body matches
 * RichDocument-derived rendering and the asset manifest is built from the same instance.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ingestDocuments,
  buildIngestRichDocument,
  renderIngestMarkdownFromRichDocument,
  externalizeEmbeddedImages,
} from '../../lib/document-ingest.mjs';
import { buildAssetManifest } from '../../lib/document-assets.mjs';
import { richDocumentBodyToMarkdown } from '../../lib/rich-document-export.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const tmpDirs = [];
after(() => { for (const dir of tmpDirs) rmTmpDir(dir); });

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

test('ingestDocuments writes markdown derived from RichDocument for plain-text sources', async () => {
  const root = tmpDir('richdoc-ingest-');
  const source = path.join(root, 'report.txt');
  const body = 'Revenue grew across all regions.\n\nSecond paragraph.';
  fs.writeFileSync(source, body, 'utf8');

  const result = await ingestDocuments([source], { cwd: root, highFidelity: false, target: 'sibling' });
  assert.equal(result.status, 'ok');
  assert.equal(result.files.length, 1);

  const outputPath = result.files[0].outputPath;
  const written = fs.readFileSync(outputPath, 'utf8');
  const extractedSection = written.split('## Extracted Content\n\n')[1]?.replace(/\n$/, '') ?? '';

  const richDoc = buildIngestRichDocument(body, { title: 'report' });
  const expectedBody = richDocumentBodyToMarkdown(richDoc);
  assert.equal(extractedSection, expectedBody, 'written body must match RichDocument-derived markdown');
});

test('ingest write helpers derive markdown and asset manifest from one RichDocument', () => {
  const root = tmpDir('richdoc-ingest-assets-');
  const mdPath = path.join(root, 'report.txt.md');
  const body = [
    '# Quarterly report',
    '',
    'Revenue grew across all regions.',
    '',
    `![chart](data:image/png;base64,${PNG_B64})`,
    '',
  ].join('\n');

  const { markdown: bodyText, assets } = externalizeEmbeddedImages(body, { mdPath });
  assert.equal(assets.length, 1);

  const richDoc = buildIngestRichDocument(bodyText.replace(/^# Quarterly report\n\n/, ''), { title: 'report' });
  const derivedBody = richDocumentBodyToMarkdown(richDoc);
  const manifest = buildAssetManifest(richDoc, { baseDir: path.dirname(mdPath) });

  assert.match(derivedBody, /!\[chart\]\(assets\/report\.txt\/image-1\.png\)/);
  assert.equal(manifest.assets.length, 1);
  assert.equal(manifest.assets[0].altText, 'chart');
});

test('renderIngestMarkdownFromRichDocument serializes ingest frontmatter around RichDocument body', () => {
  const root = tmpDir('richdoc-render-');
  const sourcePath = path.join(root, 'notes.txt');
  const outputPath = path.join(root, 'notes.txt.md');
  const body = 'Alpha line.\n\nBeta line.';
  const richDoc = buildIngestRichDocument(body, { title: 'notes' });
  const markdown = renderIngestMarkdownFromRichDocument({
    richDoc,
    sourcePath,
    extractedAt: '2026-07-20T12:00:00.000Z',
    title: 'notes',
    extractionMethod: 'node-native',
    characters: body.length,
    truncated: false,
    outputPath,
    cwd: root,
    metadata: { authors: [], dates: {} },
  });

  assert.match(markdown, /source_path:/);
  assert.match(markdown, /## Extracted Content/);
  assert.ok(markdown.includes(richDocumentBodyToMarkdown(richDoc)));
});
