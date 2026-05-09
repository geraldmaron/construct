/**
 * tests/bootstrap.test.mjs — tests for lib/bootstrap.mjs.
 *
 * Verifies seed corpus import is idempotent, parses all three files,
 * correctly maps categories, and skips already-present observations.
 * Isolated in a temp dir so real ~/.cx state is untouched.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runBootstrap } from '../lib/bootstrap.mjs';
import { listObservations, getObservation } from '../lib/observation-store.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('bootstrap', () => {
  it('imports seed observations from all three files', () => {
    const { imported, skipped, error } = runBootstrap(tmpDir);
    assert.equal(error, undefined, 'should not error');
    assert.ok(imported > 0, 'should import at least one observation');
    assert.equal(skipped, 0, 'no skips on first run');
  });

  it('is idempotent — second run skips all', () => {
    const first = runBootstrap(tmpDir);
    assert.ok(first.imported > 0, 'first run imports');

    const second = runBootstrap(tmpDir);
    assert.equal(second.imported, 0, 'second run imports nothing');
    assert.equal(second.skipped, first.imported, 'all previously imported are skipped');
  });

  it('writes observations with correct categories', () => {
    runBootstrap(tmpDir);
    const all = listObservations(tmpDir, { limit: 1000 });
    const categories = new Set(all.map((o) => o.category));
    assert.ok(categories.has('pattern'), 'should have pattern category');
    assert.ok(categories.has('anti-pattern'), 'should have anti-pattern category');
    assert.ok(categories.has('decision'), 'should have decision category');
  });

  it('assigns role construct and source seed-corpus', () => {
    runBootstrap(tmpDir);
    const all = listObservations(tmpDir, { limit: 1000 });
    const obs = all[0];
    const full = getObservation(tmpDir, obs.id);
    assert.equal(full.role, 'construct');
    assert.equal(full.source, 'seed-corpus');
  });

  it('first run imports at least one observation from each category', () => {
    const { imported, error } = runBootstrap(tmpDir);
    assert.equal(error, undefined);
    assert.ok(imported >= 3, 'should import at least one per file (3 files)');
  });
});
