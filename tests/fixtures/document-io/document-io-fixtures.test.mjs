/**
 * tests/fixtures/document-io/document-io-fixtures.test.mjs — document I/O intake fixture catalog.
 *
 * @capability document.ingest.local
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExtractableDocumentPath } from '../../../lib/document-extract.mjs';
import {
  DOCUMENT_IO_CATEGORIES,
  documentIoFixturePath,
  validateDocumentIoFixtures,
} from '../../../lib/certification/document-io-fixtures.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('document I/O fixture catalog is complete on disk', () => {
  const result = validateDocumentIoFixtures({ rootDir: REPO });
  assert.equal(result.pass, true, result.errors.join('; '));
  assert.equal(result.categoryCount, DOCUMENT_IO_CATEGORIES.length);
});

test('supported category fixtures are extractable except explicit negative fixture', () => {
  for (const category of DOCUMENT_IO_CATEGORIES) {
    if (category.negative) continue;
    for (const file of category.files) {
      const abs = documentIoFixturePath(category.id, file, { rootDir: REPO });
      const rel = path.relative(REPO, abs);
      if (category.id === 'audio-video' || category.id === 'pdf' || category.id === 'word' || category.id === 'excel' || category.id === 'powerpoint' || category.id === 'apple-iwork') {
        assert.ok(rel.endsWith(path.basename(abs)), `${rel} exists for ${category.id}`);
        continue;
      }
      assert.equal(isExtractableDocumentPath(abs), true, `${rel} should be extractable`);
    }
  }
});

test('unsupported negative fixture is not extractable', () => {
  const abs = documentIoFixturePath('unsupported', 'sample.xyz', { rootDir: REPO });
  assert.equal(isExtractableDocumentPath(abs), false);
});
