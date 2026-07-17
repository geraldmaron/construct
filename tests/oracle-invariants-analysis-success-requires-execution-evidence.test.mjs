/**
 * tests/oracle-invariants-analysis-success-requires-execution-evidence.test.mjs — the
 * `analysis-success-requires-execution-evidence` Layer 1 invariant: scheduler job-block
 * splitting, the checksRanAnalysis/persistsRanAnalysis static analysis, and check()
 * against real and fixture daemon.mjs-shaped sources.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { id, layer, splitIntoJobBlocks, analyzeJobBlock, check } from '../lib/oracle/invariants/analysis-success-requires-execution-evidence.mjs';

const VIOLATING_JOB_SOURCE = `
this.#scheduler.register(
  'execution-gap',
  2 * 60 * 60_000,
  async () => {
    const result = await this.#runExecutionGapAnalysis();
    if (this.#lastSnapshot) {
      this.#lastSnapshot.executionGaps = result.gaps;
    }
    if (!result.ranAnalysis) {
      process.stderr.write('did not run');
    }
  },
);
this.#scheduler.register(
  'other-job',
  60_000,
  async () => { /* unrelated */ },
);
`;

const CLEAN_JOB_SOURCE = `
this.#scheduler.register(
  'well-behaved-gap',
  2 * 60 * 60_000,
  async () => {
    const result = await this.#runGapAnalysis();
    this.#lastSnapshot.gapsRanAnalysis = result.ranAnalysis;
    if (!result.ranAnalysis) {
      this.#lastSnapshot.gaps = [];
    } else {
      this.#lastSnapshot.gaps = result.gaps;
    }
  },
);
`;

test('invariant module exports id/layer per the registry contract', () => {
  assert.equal(id, 'analysis-success-requires-execution-evidence');
  assert.equal(layer, 1);
});

test('splitIntoJobBlocks splits on each scheduler.register() call, each block extending to the next', () => {
  const blocks = splitIntoJobBlocks(VIOLATING_JOB_SOURCE);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].jobId, 'execution-gap');
  assert.equal(blocks[1].jobId, 'other-job');
  assert.match(blocks[0].block, /runExecutionGapAnalysis/);
  assert.doesNotMatch(blocks[0].block, /unrelated/);
});

test('analyzeJobBlock: detects a snapshot assignment sourced from result.gaps without persisting ranAnalysis', () => {
  const blocks = splitIntoJobBlocks(VIOLATING_JOB_SOURCE);
  const analysis = analyzeJobBlock(blocks[0].block);
  assert.equal(analysis.checksRanAnalysis, true);
  assert.deepEqual(analysis.snapshotAssignments, [{ field: 'executionGaps', source: 'result.gaps' }]);
  assert.equal(analysis.persistsRanAnalysis, false);
});

test('analyzeJobBlock: a job that also persists ranAnalysis into the snapshot is recognized as compliant', () => {
  const analysis = analyzeJobBlock(CLEAN_JOB_SOURCE);
  assert.equal(analysis.checksRanAnalysis, true);
  assert.equal(analysis.persistsRanAnalysis, true);
});

test('analyzeJobBlock: a job with no .ranAnalysis reference at all reports checksRanAnalysis false', () => {
  const analysis = analyzeJobBlock("async () => { this.#lastSnapshot.x = result.y; }");
  assert.equal(analysis.checksRanAnalysis, false);
});

test('check(): a job that checks ranAnalysis but drops it from the persisted snapshot is a violation', async (t) => {
  const daemonPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cx-invariant-analysis-evidence-')), 'daemon.mjs');
  t.after(() => fs.rmSync(path.dirname(daemonPath), { recursive: true, force: true }));
  fs.writeFileSync(daemonPath, VIOLATING_JOB_SOURCE);

  const result = await check({ daemonPath });
  assert.equal(result.status, 'failed');
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].job, 'execution-gap');
});

test('check(): a job that persists ranAnalysis alongside its snapshot write passes', async (t) => {
  const daemonPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cx-invariant-analysis-evidence-')), 'daemon.mjs');
  t.after(() => fs.rmSync(path.dirname(daemonPath), { recursive: true, force: true }));
  fs.writeFileSync(daemonPath, CLEAN_JOB_SOURCE);

  const result = await check({ daemonPath });
  assert.equal(result.status, 'passed');
  assert.equal(result.evaluated, 1);
});

test('check(): a job with no ranAnalysis-shaped result at all is not evaluated (no false signal)', async (t) => {
  const daemonPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cx-invariant-analysis-evidence-')), 'daemon.mjs');
  t.after(() => fs.rmSync(path.dirname(daemonPath), { recursive: true, force: true }));
  fs.writeFileSync(daemonPath, "this.#scheduler.register('unrelated', 1000, async () => { this.#lastSnapshot.x = result.y; });");

  const result = await check({ daemonPath });
  assert.equal(result.status, 'passed');
  assert.equal(result.evaluated, 0);
});

test('check(): the real lib/embed/daemon.mjs has the known, currently-open execution-gap violation', async () => {
  const result = await check({});
  assert.equal(result.status, 'failed');
  assert.ok(result.violations.some((v) => v.job === 'execution-gap'));
});

test('check(): a missing daemon.mjs degrades to collection-error, not a crash', async () => {
  const result = await check({ daemonPath: '/nonexistent/daemon.mjs/for/this/test' });
  assert.equal(result.status, 'collection-error');
});
