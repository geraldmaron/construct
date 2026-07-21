/**
 * tests/outcomes/record.test.mjs — A3 outcome recorder + aggregator + classifier tiebreaker.
 *
 * Verifies the loop:
 *   recordOutcome -> .construct/outcomes/<role>.jsonl
 *   aggregateOutcomes -> .construct/outcomes/_summary.json
 *   outcomeBoost(cwd, role) -> capped ±0.05 nudge
 *   classifyRdIntake({ cwd, ... }) still classifies correctly when no outcome data exists,
 *   and uses the soft tiebreaker without ever inverting the primary keyword signal.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { listOutcomes, recordOutcome } from '../../lib/outcomes/record.mjs';
import { aggregateOutcomes, listRolesWithOutcomes, outcomeBoost, readSummary } from '../../lib/outcomes/aggregate.mjs';
import { classifyRdIntake } from '../../lib/intake/classify.mjs';

test('recordOutcome appends one JSONL line per call', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a3-record-'));
  t.after(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {} });
  recordOutcome(cwd, { role: 'engineer', success: true, durationMs: 1200, source: 'agent-tracker' });
  recordOutcome(cwd, { role: 'engineer', success: false, durationMs: 8000, notes: 'timed out' });
  recordOutcome(cwd, { role: 'security', success: true, durationMs: 4000 });

  const engineer = listOutcomes(cwd, 'engineer');
  assert.equal(engineer.length, 2);
  assert.equal(engineer[0].success, true);
  assert.equal(engineer[1].success, false);
  assert.equal(engineer[1].notes, 'timed out');

  const security = listOutcomes(cwd, 'security');
  assert.equal(security.length, 1);
});

test('recordOutcome refuses non-boolean success', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a3-record-bad-'));
  t.after(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {} });
  assert.equal(recordOutcome(cwd, { role: 'engineer', success: 'maybe' }), null);
});

test('aggregateOutcomes produces per-role rollup with last30 window', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a3-agg-'));
  t.after(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {} });
  for (let i = 0; i < 8; i++) {
    recordOutcome(cwd, { role: 'engineer', success: i < 6, durationMs: 1000 + i * 100 });
  }
  const summary = aggregateOutcomes(cwd);
  assert.ok(summary.roles.engineer);
  assert.equal(summary.roles.engineer.count, 8);
  assert.equal(summary.roles.engineer.success, 6);
  assert.equal(summary.roles.engineer.successRate, 0.75);
  assert.equal(summary.roles.engineer.last30.count, 8);
  assert.equal(typeof summary.roles.engineer.p50DurationMs, 'number');

  const cached = readSummary(cwd);
  assert.deepEqual(cached.roles.engineer, summary.roles.engineer);
});

test('outcomeBoost is 0 below the 3-sample floor', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a3-boost-tiny-'));
  t.after(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {} });
  recordOutcome(cwd, { role: 'engineer', success: true });
  recordOutcome(cwd, { role: 'engineer', success: true });
  aggregateOutcomes(cwd);
  assert.equal(outcomeBoost(cwd, 'engineer'), 0);
});

test('outcomeBoost stays inside ±0.05 even with perfect or zero success', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a3-boost-cap-'));
  t.after(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {} });
  for (let i = 0; i < 10; i++) recordOutcome(cwd, { role: 'engineer', success: true });
  aggregateOutcomes(cwd);
  const boost = outcomeBoost(cwd, 'engineer');
  assert.ok(boost > 0 && boost <= 0.05, `boost ${boost} out of expected (0, 0.05]`);

  const cwd2 = fs.mkdtempSync(path.join(os.tmpdir(), 'a3-boost-cap-2-'));
  t.after(() => { try { fs.rmSync(cwd2, { recursive: true, force: true }); } catch {} });
  for (let i = 0; i < 10; i++) recordOutcome(cwd2, { role: 'engineer', success: false });
  aggregateOutcomes(cwd2);
  const negBoost = outcomeBoost(cwd2, 'engineer');
  assert.ok(negBoost < 0 && negBoost >= -0.05, `negBoost ${negBoost} out of expected [-0.05, 0)`);
});

test('classifyRdIntake works when no outcome store exists (zero-impact when missing)', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a3-classify-noop-'));
  t.after(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {} });
  const triage = classifyRdIntake({
    sourcePath: 'bug.md',
    extractedText: 'crash stack trace exception fails',
    cwd,
  });
  assert.equal(triage.intakeType, 'bug');
  assert.equal(triage.primaryOwner, 'debugger');
});

test('classifyRdIntake outcome boost never inverts a clear keyword winner', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a3-classify-boost-'));
  t.after(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {} });
  // Stuff failure history into 'debugger' so its boost goes negative.
  for (let i = 0; i < 20; i++) recordOutcome(cwd, { role: 'debugger', success: false });
  aggregateOutcomes(cwd);

  const triage = classifyRdIntake({
    sourcePath: 'bug.md',
    extractedText: 'crash stack trace exception fails broken regression error',
    cwd,
  });
  // bug has many keywords matching; even with negative boost on debugger,
  // the keyword score dominates the cap.
  assert.equal(triage.intakeType, 'bug');
  assert.equal(triage.primaryOwner, 'debugger');
});

test('listRolesWithOutcomes returns the union of active and rotated files', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a3-list-roles-'));
  t.after(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {} });
  recordOutcome(cwd, { role: 'engineer', success: true });
  recordOutcome(cwd, { role: 'security', success: true });
  recordOutcome(cwd, { role: 'engineer', success: false });
  const roles = listRolesWithOutcomes(cwd);
  assert.deepEqual(roles, ['engineer', 'security']);
});
