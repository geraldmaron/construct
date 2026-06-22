/**
 * tests/certification/document-io-cert.test.mjs — fidelity and strict-mode certification.
 *
 * @capability ingest.document-io
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateDocumentIoFixtures, DOCUMENT_IO_CATEGORIES } from '../../lib/certification/document-io-fixtures.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('document-io fixture catalog covers every category', () => {
  const result = validateDocumentIoFixtures({ rootDir: REPO });
  assert.equal(result.pass, true, result.errors.join('\n'));
  assert.equal(result.categoryCount, DOCUMENT_IO_CATEGORIES.length);
});

test('strict-mode error codes are documented in document-io reference', async () => {
  const doc = await import('node:fs/promises').then((fs) =>
    fs.readFile(path.join(REPO, 'docs/reference/document-io.md'), 'utf8'),
  );
  for (const code of ['ASR_REQUIRED', 'OFFICE_REQUIRES_DOCLING']) {
    assert.match(doc, new RegExp(code));
  }
});
