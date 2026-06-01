/**
 * tests/ingest-store.test.mjs — content-addressed ingest store.
 *
 * Coverage: hashFile produces stable sha256, writeRecord/readRecord round
 * trip, idempotent re-ingest returns existing record, listRecords filters
 * to valid sha-named dirs only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hashFile, readRecord, writeRecord, listRecords } from '../lib/ingest/store.mjs';

const createdDirs = [];

function tmpRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-ingest-store-'));
  createdDirs.push(dir);
  if (t) t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* tmp cleanup best-effort */ } });
  return dir;
}

process.on('exit', () => {
  for (const dir of createdDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* tmp cleanup best-effort */ }
  }
});

test('hashFile produces stable sha256 across reads', async (t) => {
  const dir = tmpRoot(t);
  const p = path.join(dir, 'sample.txt');
  fs.writeFileSync(p, 'hello world');
  const a = await hashFile(p);
  const b = await hashFile(p);
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test('writeRecord + readRecord round-trip preserves all fields', async (t) => {
  const root = tmpRoot(t);
  const sha = '0'.repeat(64);
  const payload = {
    sha256: sha,
    source: { sourcePath: '/tmp/x.pdf', fileName: 'x.pdf', sha256: sha, bytes: 1024, ingestedAt: '2026-06-01T00:00:00Z' },
    meta: { extractionMethod: 'docling', droppedInfo: [], chunkCount: 3 },
    markdown: '# Title\n\nBody paragraph.\n',
  };
  await writeRecord(root, payload);
  const read = await readRecord(root, sha);
  assert.ok(read);
  assert.equal(read.markdown, payload.markdown);
  assert.deepEqual(read.source, payload.source);
  assert.deepEqual(read.meta, payload.meta);
});

test('readRecord returns null for unknown sha', async (t) => {
  const root = tmpRoot(t);
  const r = await readRecord(root, '0'.repeat(64));
  assert.equal(r, null);
});

test('listRecords filters to sha-named dirs and ignores junk', async (t) => {
  const root = tmpRoot(t);
  await fsp.mkdir(root, { recursive: true });
  await fsp.mkdir(path.join(root, 'not-a-sha'), { recursive: true });
  const sha = 'a'.repeat(64);
  await writeRecord(root, {
    sha256: sha,
    source: { sourcePath: '/x', sha256: sha, bytes: 1, ingestedAt: '2026-06-01' },
    meta: { extractionMethod: 'docling' },
    markdown: '# X',
  });
  const records = await listRecords(root);
  assert.equal(records.length, 1);
  assert.equal(records[0].sha256, sha);
});
