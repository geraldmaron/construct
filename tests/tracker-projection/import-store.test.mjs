/**
 * tests/tracker-projection/import-store.test.mjs — importer + durable store.
 *
 * importBeads builds raw-record-preserving projections from a bd snapshot and
 * never touches bd; verifyRawRecords proves zero data loss and catches a
 * dropped field; snapshotBeads parses an injected bd read; the JSONL store
 * round-trips and upserts by id.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { importBeads, verifyRawRecords, snapshotBeads } from '../../lib/tracker-projection/import-beads.mjs';
import { buildProjection } from '../../lib/tracker-projection/projection.mjs';
import {
  writeProjections,
  loadProjections,
  loadProjectionsMeta,
  upsertProjections,
  projectionsDir,
} from '../../lib/tracker-projection/store.mjs';

function issue(id, overrides = {}) {
  return { id, title: `t-${id}`, status: 'open', priority: 2, dependency_count: 0, comment_count: 0, ...overrides };
}

test('importBeads builds one projection per issue and preserves raw records', () => {
  const issues = [issue('b-1'), issue('b-2')];
  const { projections, stats } = importBeads(issues, { workspace: 'ws' });
  assert.equal(projections.length, 2);
  assert.equal(stats.imported, 2);
  assert.equal(verifyRawRecords(projections, issues).ok, true);
});

test('importBeads collects malformed inputs under skipped rather than dropping silently', () => {
  const { projections, stats } = importBeads([issue('b-1'), { title: 'no id' }, null]);
  assert.equal(projections.length, 1);
  assert.equal(stats.skipped.length, 2);
});

test('verifyRawRecords catches a dropped field (data loss)', () => {
  const original = issue('b-1', { extra_field: 'must survive' });
  const projection = buildProjection(original);
  delete projection.raw_record.extra_field;
  const result = verifyRawRecords([projection], [original]);
  assert.equal(result.ok, false);
  assert.equal(result.mismatches[0].reason, 'raw-record-differs');
  assert.ok(result.mismatches[0].lostKeys.includes('extra_field'));
});

test('verifyRawRecords flags a projection with no matching source issue', () => {
  const projection = buildProjection(issue('b-1'));
  const result = verifyRawRecords([projection], []);
  assert.equal(result.ok, false);
  assert.equal(result.mismatches[0].reason, 'no-source-issue');
});

test('snapshotBeads parses an injected bd read (array or {issues})', () => {
  const asArray = snapshotBeads({ runner: () => ({ status: 0, stdout: JSON.stringify([issue('b-1')]) }) });
  assert.equal(asArray.length, 1);
  const asObject = snapshotBeads({ runner: () => ({ status: 0, stdout: JSON.stringify({ issues: [issue('b-1'), issue('b-2')] }) }) });
  assert.equal(asObject.length, 2);
});

test('snapshotBeads parses valid stdout even when bd exits non-zero under buffer pressure', () => {
  const parsed = snapshotBeads({ runner: () => ({ status: null, signal: 'SIGPIPE', stdout: JSON.stringify([issue('b-1')]) }) });
  assert.equal(parsed.length, 1);
});

test('snapshotBeads returns [] on unparseable output', () => {
  assert.deepEqual(snapshotBeads({ runner: () => ({ status: 0, stdout: 'not json' }) }), []);
});

test('the projection store round-trips through JSONL', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-projection-store-'));
  try {
    const { projections } = importBeads([issue('b-1'), issue('b-2')]);
    const { count, dir } = writeProjections(root, projections);
    assert.equal(count, 2);
    assert.equal(dir, projectionsDir(root));
    assert.ok(fs.existsSync(path.join(dir, 'beads.jsonl')));
    const loaded = loadProjections(root);
    assert.equal(loaded.length, 2);
    assert.deepEqual(loaded.map((p) => p.external_id).sort(), ['b-1', 'b-2']);
    assert.equal(loadProjectionsMeta(root).count, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('upsertProjections replaces by id and appends new ids without duplicating', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-projection-upsert-'));
  try {
    writeProjections(root, importBeads([issue('b-1', { status: 'open' })]).projections);
    upsertProjections(root, importBeads([issue('b-1', { status: 'closed' }), issue('b-2')]).projections);
    const loaded = loadProjections(root);
    assert.equal(loaded.length, 2, 'b-1 updated in place, b-2 appended');
    const b1 = loaded.find((p) => p.external_id === 'b-1');
    assert.equal(b1.fields.status, 'closed', 're-import updates the row');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjections returns [] when the store does not exist', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-projection-empty-'));
  try {
    assert.deepEqual(loadProjections(root), []);
    assert.equal(loadProjectionsMeta(root), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
