/**
 * tests/embed-degradation.test.mjs — durable capability-decline ledger
 * (lib/embed/degradation.mjs).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { recordDegradation, listDegradations } from '../lib/embed/degradation.mjs';

let rootDir;

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-degradation-'));
});

afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true });
});

describe('recordDegradation / listDegradations', () => {
  it('returns an empty list when nothing has been recorded', () => {
    assert.deepEqual(listDegradations(rootDir), []);
  });

  it('records and lists a single entry with a stamped timestamp', () => {
    const entry = recordDegradation(rootDir, { job: 'directive-runner', reason: 'unknown-specialist', detail: 'cx-nonexistent' });
    assert.equal(entry.job, 'directive-runner');
    assert.equal(entry.reason, 'unknown-specialist');
    assert.ok(entry.at);

    const listed = listDegradations(rootDir);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].detail, 'cx-nonexistent');
  });

  it('appends multiple entries in order', () => {
    recordDegradation(rootDir, { job: 'a', reason: 'r1' });
    recordDegradation(rootDir, { job: 'b', reason: 'r2' });
    const listed = listDegradations(rootDir);
    assert.equal(listed.length, 2);
    assert.equal(listed[0].job, 'a');
    assert.equal(listed[1].job, 'b');
  });

  it('defaults detail to null when omitted', () => {
    recordDegradation(rootDir, { job: 'a', reason: 'r1' });
    assert.equal(listDegradations(rootDir)[0].detail, null);
  });
});
