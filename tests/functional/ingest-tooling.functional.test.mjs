/**
 * tests/functional/ingest-tooling.functional.test.mjs — ingest pipeline detect contract.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectIngestPipeline, detectNodeNativeDeps } from '../../lib/ingest-tooling.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('detectNodeNativeDeps reports unpdf/mammoth presence on this repo', () => {
  const result = detectNodeNativeDeps({ repoRoot: REPO });
  assert.equal(result.ok, true);
  assert.equal(typeof result.unpdf, 'boolean');
  assert.equal(typeof result.mammoth, 'boolean');
});

test('detectIngestPipeline returns structured steps', () => {
  const result = detectIngestPipeline({ cwd: REPO, repoRoot: REPO });
  assert.equal(result.ok, true);
  assert.ok(result.steps.docling);
  assert.ok(result.steps.nodeNative);
  assert.ok(result.steps.whisper);
  assert.ok(result.steps.doclingRemote);
  assert.match(result.message, /Ingest/i);
});
