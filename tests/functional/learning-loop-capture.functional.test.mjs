/**
 * tests/functional/learning-loop-capture.functional.test.mjs
 *
 * Characterization tests for the learning-loop tool-miss capture (self-audit construct-rr63.9.1,
 * under the tool-contract-gate). Agent I found the capture is write-only: recordToolNameMiss
 * (lib/mcp/tool-recovery.mjs:35) appends to .construct/observations/tool-name-misses.jsonl, but a
 * repo-wide search finds no reader/aggregator that surfaces those misses. These tests pin both
 * halves: the producer writes a well-formed, appendable JSONL entry, and the module exposes no
 * consumer API. The Wave-4 follow-on (a doctor watcher / oracle action that reads the file and
 * raises beads for repeatedly-misnamed tools, plus the full session->observe->consolidate->inject
 * loop and failure capture) flips the consumer-absence assertion deliberately.
 *
 * construct-bh8h4 closes the remaining gap: the aggregated misses reached learning-status but
 * never the Oracle gap pipeline. collectReadModel now attaches toolDiscoverability, synthesizeVerdict
 * emits a 'tool-discoverability' gap once unrecovered misses cross the threshold, and the gap is
 * verdict-only (lib/oracle/policy.mjs's VERDICT_ONLY_GAP_IDS) — it surfaces in doctor/prelude/
 * `construct oracle gaps` but can never auto-raise a bead, matching the ADR-0043 auto-envelope.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as toolRecovery from '../../lib/mcp/tool-recovery.mjs';
import { recordToolNameMiss } from '../../lib/mcp/tool-recovery.mjs';
import { collectReadModel } from '../../lib/oracle/read-model.mjs';
import { synthesizeVerdict } from '../../lib/oracle/synthesize.mjs';
import { isVerdictOnlyGap, autoRaiseEnabledForGap } from '../../lib/oracle/policy.mjs';
import { doctorRoot } from '../../lib/config/xdg.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const roots = [];
function root() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-toolmiss-'));
  roots.push(dir);
  return dir;
}
function readMisses(rootDir) {
  const file = path.join(rootDir, '.construct', 'observations', 'tool-name-misses.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
test.after(() => { for (const d of roots) { try { rmTmpDir(d); } catch {} } });

test('recordToolNameMiss writes a well-formed tool-name-miss entry', () => {
  const rootDir = root();
  recordToolNameMiss(rootDir, { name: 'construct_call', recovered: 'call' });
  const misses = readMisses(rootDir);
  assert.equal(misses.length, 1, 'one miss recorded');
  const m = misses[0];
  assert.equal(m.kind, 'tool-name-miss');
  assert.equal(m.name, 'construct_call');
  assert.equal(m.recovered, 'call');
  assert.equal(typeof m.at, 'string', 'entry is timestamped');
});

test('misses accumulate as an append-only JSONL log a consumer could aggregate', () => {
  const rootDir = root();
  recordToolNameMiss(rootDir, { name: 'construct-mcp_export', recovered: 'export' });
  recordToolNameMiss(rootDir, { name: 'unknown_tool', recovered: null });
  const misses = readMisses(rootDir);
  assert.equal(misses.length, 2, 'each miss appends a line');
  assert.deepEqual(misses.map((m) => m.name), ['construct-mcp_export', 'unknown_tool']);
});

// The tool-miss capture is consumable (construct-rr63.9.2): summarizeToolNameMisses reads and
// aggregates the JSONL by name, and learning-status surfaces the top misses. This pins that the
// consumer exists and aggregates correctly.

test('the tool-miss consumer aggregates recorded misses by name', () => {
  assert.equal(typeof toolRecovery.summarizeToolNameMisses, 'function', 'consumer export exists');
  const rootDir = root();
  recordToolNameMiss(rootDir, { name: 'construct_call', recovered: 'call' });
  recordToolNameMiss(rootDir, { name: 'construct_call', recovered: 'call' });
  recordToolNameMiss(rootDir, { name: 'mystery_tool', recovered: null });
  const summary = toolRecovery.summarizeToolNameMisses(rootDir);
  assert.equal(summary.total, 3, 'all misses counted');
  assert.equal(summary.recovered, 2, 'recovered misses counted');
  assert.equal(summary.top[0].name, 'construct_call', 'most-missed name ranks first');
  assert.equal(summary.top[0].count, 2);
});

test('failure capture records and aggregates tool failures into a learnable anti-pattern', () => {
  assert.equal(typeof toolRecovery.recordToolFailure, 'function', 'failure capture export exists');
  const rootDir = root();
  toolRecovery.recordToolFailure(rootDir, { tool: 'ingest_document', code: 'TIMEOUT', message: 'docling timed out' });
  toolRecovery.recordToolFailure(rootDir, { tool: 'ingest_document', code: 'TIMEOUT', message: 'again' });
  toolRecovery.recordToolFailure(rootDir, { tool: 'publish_run', code: 'INVALID_INPUT', message: 'no artifact' });
  const summary = toolRecovery.summarizeToolFailures(rootDir);
  assert.equal(summary.total, 3, 'all failures counted');
  assert.equal(summary.top[0].name, 'ingest_document', 'most-failed tool ranks first');
  assert.equal(summary.top[0].count, 2);
});

// construct-bh8h4: the Oracle read model / synthesize / policy pipeline, not just
// learning-status, must surface a tool-discoverability signal. collectReadModel needs a real
// registry tree to assemble the registry (collectTeamGovernance), so rootDir is a fresh
// copy of it rather than a bare tmpdir — the same fixture shape as
// tests/functional/oracle-read-model.functional.test.mjs.

function freshOracleEnv() {
  const projectDir = root();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-toolmiss-home-'));
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-toolmiss-root-'));
  roots.push(homeDir, rootDir);
  fs.mkdirSync(path.join(projectDir, '.construct', 'observations'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, '.construct', 'outcomes'), { recursive: true });
  fs.mkdirSync(doctorRoot(homeDir), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'audit-artifacts'), { recursive: true });
  fs.cpSync(
    path.join(process.cwd(), 'registry'),
    path.join(rootDir, 'registry'),
    { recursive: true },
  );
  return { projectDir, homeDir, rootDir };
}

test('collectReadModel attaches toolDiscoverability from the recorded misses/failures', () => {
  const env = freshOracleEnv();
  recordToolNameMiss(env.projectDir, { name: 'orchestration_delegation_next', recovered: false });
  recordToolNameMiss(env.projectDir, { name: 'orchestration_delegation_next', recovered: false });
  toolRecovery.recordToolFailure(env.projectDir, { tool: 'ingest_document', code: 'TIMEOUT', message: 'x' });

  const model = collectReadModel(env);
  assert.equal(model.toolDiscoverability.misses.total, 2);
  assert.equal(model.toolDiscoverability.misses.top[0].name, 'orchestration_delegation_next');
  assert.equal(model.toolDiscoverability.failures.total, 1);
});

test('synthesizeVerdict emits a verdict-only tool-discoverability gap once unrecovered misses cross the threshold', () => {
  const env = freshOracleEnv();
  for (let i = 0; i < 6; i++) {
    recordToolNameMiss(env.projectDir, { name: 'orchestration_delegation_next', recovered: false });
  }

  const verdict = synthesizeVerdict(collectReadModel(env));
  const gapEntry = verdict.gaps.find((g) => g.id === 'tool-discoverability');
  assert.ok(gapEntry, 'gap must appear once unrecovered misses cross the threshold');
  assert.equal(gapEntry.severity, 'low');
  assert.match(gapEntry.detail, /orchestration_delegation_next/);
  assert.equal(isVerdictOnlyGap(gapEntry), true, 'must be classified verdict-only');
  assert.equal(
    autoRaiseEnabledForGap({ ...gapEntry, severity: 'high' }),
    false,
    'verdict-only must block auto-raise even if severity were forced to high',
  );
});

test('synthesizeVerdict stays silent on tool-discoverability below the threshold', () => {
  const env = freshOracleEnv();
  recordToolNameMiss(env.projectDir, { name: 'some_tool', recovered: false });
  recordToolNameMiss(env.projectDir, { name: 'some_tool', recovered: false });

  const verdict = synthesizeVerdict(collectReadModel(env));
  assert.equal(
    verdict.gaps.find((g) => g.id === 'tool-discoverability'),
    undefined,
    'below-threshold misses must not raise a gap',
  );
});
