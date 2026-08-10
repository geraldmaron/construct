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
import { EXTRACTABLE_DOCUMENT_EXTS } from '../../lib/document-extract.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('document-io fixture catalog covers every category', () => {
  const result = validateDocumentIoFixtures({ rootDir: REPO });
  assert.equal(result.pass, true, result.errors.join('\n'));
  assert.equal(result.categoryCount, DOCUMENT_IO_CATEGORIES.length);
});

test('extractor declares presentation and raster image imports as supported', () => {
  for (const ext of ['.odp', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp']) {
    assert.equal(EXTRACTABLE_DOCUMENT_EXTS.has(ext), true, `${ext} should be extractable through high-fidelity ingest`);
  }
});
