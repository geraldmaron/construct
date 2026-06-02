/**
 * tests/embedded-contract-ingest.test.mjs — unit tests for file→text resolution.
 *
 * Pins that inline text passes through untouched, a recognized file is read via
 * the extraction pipeline (with extractionMethod surfaced), an unrecognized
 * extension degrades to a flagged raw read, and a missing file returns a
 * structured error rather than throwing.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { resolveInput } from '../lib/embedded-contract/ingest.mjs';

const tmpDirs = [];
function fixture(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-ingest-'));
  tmpDirs.push(dir);
  const full = path.join(dir, name);
  fs.writeFileSync(full, content);
  return full;
}
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

test('inline text passes through with no ingestion metadata', async () => {
  const r = await resolveInput({ input: 'hello world' });
  assert.equal(r.text, 'hello world');
  assert.equal(r.ingestion, null);
  assert.equal(r.error, null);
});

test('a recognized text file is read through the extraction pipeline', async () => {
  const r = await resolveInput({ filePath: fixture('note.txt', 'Bug: throws an error in production') });
  assert.match(r.text, /throws an error/);
  assert.equal(r.ingestion.extractionMethod, 'utf8');
  assert.equal(r.error, null);
});

test('csv is handled by extraction, not the raw fallback', async () => {
  const r = await resolveInput({ filePath: fixture('data.csv', 'a,b\n1,2\n') });
  assert.equal(r.ingestion.extractionMethod, 'utf8');
});

test('an unrecognized extension degrades to a flagged raw read', async () => {
  const r = await resolveInput({ filePath: fixture('blob.parquet', 'plain text content') });
  assert.equal(r.ingestion.extractionMethod, 'raw-utf8');
  assert.match(r.ingestion.note, /No structured extractor/);
  assert.equal(r.error, null);
});

test('a missing file returns a structured error, not a throw', async () => {
  const r = await resolveInput({ filePath: '/nonexistent/path/x.parquet' });
  assert.equal(r.text, '');
  assert.equal(r.error.code, 'FILE_UNREADABLE');
  assert.ok(r.error.remediation);
});

test('empty request yields empty text', async () => {
  const r = await resolveInput({});
  assert.equal(r.text, '');
  assert.equal(r.ingestion, null);
});
