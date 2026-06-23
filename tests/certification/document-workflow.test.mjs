/**
 * tests/certification/document-workflow.test.mjs — ingest to export workflow certification.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateDocumentWorkflowCertification } from '../../lib/certification/document-workflow.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('pdf and word intake classes round-trip with export path', () => {
  const result = validateDocumentWorkflowCertification({ rootDir: REPO });
  assert.equal(result.pass, true, result.errors.join('\n'));
  assert.equal(result.scenarios.length, 2);
});
