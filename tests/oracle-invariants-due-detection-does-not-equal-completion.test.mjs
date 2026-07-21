/**
 * tests/oracle-invariants-due-detection-does-not-equal-completion.test.mjs — the
 * `due-detection-does-not-equal-completion` Layer 2 invariant: directive-runner
 * must not stamp lastRunAt without execution/handoff markers.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { id, layer, analyzeDirectiveRunnerBlock, check } from '../lib/oracle/invariants/due-detection-does-not-equal-completion.mjs';

const VIOLATING_BLOCK = `
this.#scheduler.register(
  'directive-runner',
  60_000,
  async () => {
    if (!isDirectiveDue(directive, state)) continue;
    writeDirectiveState(this.#rootDir, directive.id, { lastRunAt: new Date().toISOString() });
    process.stderr.write('directive is due');
  },
);
`;

const CLEAN_BLOCK = `
this.#scheduler.register(
  'directive-runner',
  60_000,
  async () => {
    if (!isDirectiveDue(directive, state)) continue;
    await executeDirective({ projectDir: this.#rootDir, directive });
    writeDirectiveState(this.#rootDir, directive.id, { lastRunAt: new Date().toISOString() });
  },
);
`;

function tempDaemon(source, t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-due-detect-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lib = path.join(dir, 'lib', 'embed');
  fs.mkdirSync(lib, { recursive: true });
  const daemonPath = path.join(lib, 'daemon.mjs');
  fs.writeFileSync(daemonPath, source);
  return { cwd: dir, daemonPath };
}

test('invariant module exports id/layer per the registry contract', () => {
  assert.equal(id, 'due-detection-does-not-equal-completion');
  assert.equal(layer, 2);
});

test('analyzeDirectiveRunnerBlock flags lastRunAt stamping without execution handoff', () => {
  const analysis = analyzeDirectiveRunnerBlock(VIOLATING_BLOCK);
  assert.equal(analysis.stampsLastRunAt, true);
  assert.equal(analysis.hasExecutionHandoff, false);
});

test('analyzeDirectiveRunnerBlock passes when executeDirective is present', () => {
  const analysis = analyzeDirectiveRunnerBlock(CLEAN_BLOCK);
  assert.equal(analysis.stampsLastRunAt, true);
  assert.equal(analysis.hasExecutionHandoff, true);
});

test('check reports failed against a fixture daemon that only stamps lastRunAt', async (t) => {
  const { cwd, daemonPath } = tempDaemon(`this.#scheduler.register('directive-runner', 1, async () => {
    writeDirectiveState(root, id, { lastRunAt: new Date().toISOString() });
  });`, t);
  const result = await check({ cwd, daemonPath });
  assert.equal(result.status, 'failed');
  assert.equal(result.violations.length, 1);
});

test('check reports passed against a fixture daemon that executes before stamping', async (t) => {
  const { cwd, daemonPath } = tempDaemon(`this.#scheduler.register('directive-runner', 1, async () => {
    await executeDirective({ projectDir: root, directive });
    writeDirectiveState(root, id, { lastRunAt: new Date().toISOString() });
  });`, t);
  const result = await check({ cwd, daemonPath });
  assert.equal(result.status, 'passed');
});

test('check against the real repo daemon detects the known due-stamp coupling', async () => {
  const result = await check({ cwd: process.cwd() });
  assert.equal(result.evaluated, 1);
  assert.equal(result.status, 'failed');
  assert.match(result.violations[0].detail, /lastRunAt/);
  assert.deepEqual(result.violations[0].coupledReaders, ['lib/oracle/read-model.mjs']);
});
