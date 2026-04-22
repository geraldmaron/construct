/**
 * tests/document-ingest.test.mjs — document ingest CLI/library behavior tests.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ingestDocuments } from '../lib/document-ingest.mjs';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('ingestDocuments writes markdown into product-intel by default', async () => {
  const root = tempDir('construct-ingest-root-');
  const source = path.join(root, 'imports', 'brief.csv');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'service,availability\napi,99.95\nworker,99.90\n');

  const result = await ingestDocuments([source], { cwd: root });

  assert.equal(result.status, 'ok');
  assert.equal(result.indexedLocally, true);
  assert.equal(result.files.length, 1);
  assert.match(result.files[0].outputPath, /\.cx\/product-intel\/sources\/ingested\/brief\.csv\.md$/);

  const markdown = fs.readFileSync(result.files[0].outputPath, 'utf8');
  assert.match(markdown, /source_extension: ".csv"/);
  assert.match(markdown, /## Extracted Content/);
  assert.match(markdown, /service,availability/);
  assert.match(markdown, /worker,99.90/);
});

test('ingestDocuments can write sibling markdown files for source documents', async () => {
  const root = tempDir('construct-ingest-sibling-');
  const source = path.join(root, 'slides', 'deck.txt');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'Quarterly review\nReliability targets and incidents.\n');

  const result = await ingestDocuments([source], { cwd: root, target: 'sibling' });

  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].outputPath, `${source}.md`);
  assert.equal(fs.existsSync(`${source}.md`), true);
});

test('ingestDocuments recursively ingests supported files from directories', async () => {
  const root = tempDir('construct-ingest-dir-');
  const docsDir = path.join(root, 'drop');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'a.csv'), 'name,value\nalpha,1\n');
  fs.writeFileSync(path.join(docsDir, 'b.md'), '# Note\n\nShip it.\n');
  fs.writeFileSync(path.join(docsDir, 'ignore.bin'), Buffer.from([0, 1, 2, 3]));

  const result = await ingestDocuments([docsDir], { cwd: root });

  assert.equal(result.files.length, 2);
  assert.deepEqual(
    result.files.map((entry) => path.basename(entry.sourcePath)).sort(),
    ['a.csv', 'b.md'],
  );
});

