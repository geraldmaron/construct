/**
 * tests/oracle-invariants-external-write-has-idempotency-and-reconciliation.test.mjs —
 * the `external-write-has-idempotency-and-reconciliation` Layer 1 invariant: per-
 * capability source-pattern detection against real and fixture producer files.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { id, layer, EXTERNAL_WRITE_PRODUCERS, check } from '../lib/oracle/invariants/external-write-has-idempotency-and-reconciliation.mjs';

test('invariant module exports id/layer per the registry contract', () => {
  assert.equal(id, 'external-write-has-idempotency-and-reconciliation');
  assert.equal(layer, 1);
});

test('EXTERNAL_WRITE_PRODUCERS names the two real writers this invariant tracks', () => {
  const ids = EXTERNAL_WRITE_PRODUCERS.map((p) => p.id);
  assert.deepEqual(ids, ['sent-log', 'approval-queue']);
});

test('check(): a producer missing the idempotent temp-file-then-rename pattern is a violation', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-invariant-external-write-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.mkdirSync(path.join(cwd, 'lib', 'writes'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, 'lib', 'writes', 'sent-log.mjs'),
    "function persist() { fs.writeFileSync(this.persistPath, data); }\n",
  );

  const result = await check({
    cwd,
    producers: [{ id: 'sent-log', file: 'lib/writes/sent-log.mjs', requires: ['idempotent-persist'] }],
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.violations[0].capability, 'idempotent-persist');
});

test('check(): a producer with the temp-file-then-rename pattern passes', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-invariant-external-write-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.mkdirSync(path.join(cwd, 'lib', 'writes'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, 'lib', 'writes', 'sent-log.mjs'),
    "function persist() { const tmp = path + '.tmp'; fs.writeFileSync(tmp, data); fs.renameSync(tmp, path); }\n",
  );

  const result = await check({
    cwd,
    producers: [{ id: 'sent-log', file: 'lib/writes/sent-log.mjs', requires: ['idempotent-persist'] }],
  });
  assert.equal(result.status, 'passed');
});

test('check(): a producer requiring lease-reconciliation without all four lease methods is a violation', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-invariant-external-write-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.mkdirSync(path.join(cwd, 'lib', 'embed'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, 'lib', 'embed', 'approval-queue.mjs'),
    "function acquireLease() {}\nfunction heartbeatLease() {}\n",
  );

  const result = await check({
    cwd,
    producers: [{ id: 'approval-queue', file: 'lib/embed/approval-queue.mjs', requires: ['lease-reconciliation'] }],
  });
  assert.equal(result.status, 'failed');
  assert.match(result.violations[0].detail, /lease/);
});

test('check(): a missing producer file degrades that entry to collection-error without crashing the run', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-invariant-external-write-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));

  const result = await check({
    cwd,
    producers: [{ id: 'ghost', file: 'lib/writes/does-not-exist.mjs', requires: ['idempotent-persist'] }],
  });
  assert.equal(result.status, 'collection-error');
});

test('check(): the real repo on feat/workspace-control-plane surfaces standing external-write gaps (sent-log, approval-queue)', async () => {
  const result = await check({});
  assert.equal(result.status, 'failed');
  assert.ok(result.evaluated >= 4);
  assert.ok(result.violations.some((v) => v.producer === 'sent-log'));
  assert.ok(result.violations.some((v) => v.producer === 'approval-queue'));
});
