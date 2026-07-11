/**
 * tests/contracts-violation-log.test.mjs — unit tests for the ported
 * tamper-evident violation log.
 *
 * Pins three guarantees:
 *   1. logViolation appends a JSONL record with a monotonic `sequence` and
 *      a prev_line_hash that matches sha256 of the prior line.
 *   2. recentViolations reads the active segment and filters by window.
 *   3. verifyChain detects both hash mismatch and sequence gaps.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

let tmpRoot;
let priorCwd;
let priorHome;
let logViolation;
let recentViolations;
let verifyChain;
let markContractViolationsSuperseded;
let readViolationSupersedeCutoff;

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'cx-violation-log-'));
  mkdirSync(join(tmpRoot, '.construct'), { recursive: true });
  priorCwd = process.cwd();
  priorHome = process.env.HOME;
  process.env.HOME = tmpRoot;
  process.chdir(tmpRoot);

  // Force fresh module load so logFile() resolves against the new cwd/HOME.
  const mod = await import(`../lib/contracts/violation-log.mjs?cache=${Date.now()}`);
  ({
    logViolation,
    recentViolations,
    verifyChain,
    markContractViolationsSuperseded,
    readViolationSupersedeCutoff,
  } = mod);
});

afterEach(() => {
  process.chdir(priorCwd);
  process.env.HOME = priorHome;
  rmSync(tmpRoot, { recursive: true, force: true });
});

function readLog() {
  const file = join(tmpRoot, '.construct', 'contract-violations.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function rawLines() {
  const file = join(tmpRoot, '.construct', 'contract-violations.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
}

function sha256(s) { return createHash('sha256').update(s).digest('hex'); }

describe('violation-log', () => {
  test('logViolation appends with sequence starting at 1 and increments monotonically', () => {
    logViolation('contract-a', 'output', ['x'], { x: 1 });
    logViolation('contract-a', 'output', ['y'], { y: 2 });
    logViolation('contract-b', 'input',  ['z'], { z: 3 });

    const records = readLog();
    assert.equal(records.length, 3);
    assert.equal(records[0].sequence, 1);
    assert.equal(records[1].sequence, 2);
    assert.equal(records[2].sequence, 3);
  });

  test('prev_line_hash on record N equals sha256 of the raw line N-1', () => {
    logViolation('contract-a', 'output', ['x'], { x: 1 });
    logViolation('contract-a', 'output', ['y'], { y: 2 });

    const records = readLog();
    const lines = rawLines();
    assert.equal(records[0].prev_line_hash, null);
    assert.equal(records[1].prev_line_hash, sha256(lines[0]));
  });

  test('extra fields (verdict, postconditionFailures) are spread into the record', () => {
    logViolation('contract-a', 'output', [], { x: 1 }, {
      verdict: 'BLOCKED_CONTRACT',
      postconditionFailures: [{ id: 'reviewer.findings-or-explicit-clear', reason: 'empty findings' }],
    });

    const [record] = readLog();
    assert.equal(record.verdict, 'BLOCKED_CONTRACT');
    assert.equal(record.postconditionFailures[0].id, 'reviewer.findings-or-explicit-clear');
  });

  test('recentViolations filters by windowMs', async () => {
    logViolation('contract-a', 'output', ['x'], { x: 1 });
    await new Promise((r) => setTimeout(r, 25));
    const stale = recentViolations({ windowMs: 10 });
    assert.equal(stale.length, 0);
    const all = recentViolations({ windowMs: 60_000 });
    assert.equal(all.length, 1);
  });

  test('verifyChain returns ok on a fresh, intact log', () => {
    logViolation('contract-a', 'output', ['x'], { x: 1 });
    logViolation('contract-a', 'output', ['y'], { y: 2 });
    logViolation('contract-a', 'output', ['z'], { z: 3 });

    assert.deepEqual(verifyChain(), { ok: true });
  });

  test('verifyChain detects a sequence gap', () => {
    logViolation('contract-a', 'output', ['x'], { x: 1 });
    logViolation('contract-a', 'output', ['y'], { y: 2 });

    const file = join(tmpRoot, '.construct', 'contract-violations.jsonl');
    const lines = rawLines();
    const forged = JSON.parse(lines[1]);
    forged.sequence = 3;
    writeFileSync(file, lines[0] + '\n' + JSON.stringify(forged) + '\n', 'utf8');

    const result = verifyChain();
    assert.equal(result.ok, false);
    assert.match(result.brokenAt.reason, /sequence gap/);
  });

  test('verifyChain detects a prev_line_hash mismatch', () => {
    logViolation('contract-a', 'output', ['x'], { x: 1 });
    logViolation('contract-a', 'output', ['y'], { y: 2 });

    const file = join(tmpRoot, '.construct', 'contract-violations.jsonl');
    const lines = rawLines();
    const tampered = JSON.parse(lines[0]);
    tampered.missing = ['MUTATED'];
    writeFileSync(file, JSON.stringify(tampered) + '\n' + lines[1] + '\n', 'utf8');

    const result = verifyChain();
    assert.equal(result.ok, false);
    assert.match(result.brokenAt.reason, /prev_line_hash mismatch/);
  });

  test('verifyChain on missing log returns ok', () => {
    assert.deepEqual(verifyChain(), { ok: true });
  });

  test('logViolation skips consecutive identical violations', () => {
    logViolation('construct-to-orchestrator', 'input', ['intent'], { goal: 'x' }, { repoRoot: tmpRoot });
    logViolation('construct-to-orchestrator', 'input', ['intent'], { goal: 'x' }, { repoRoot: tmpRoot });
    assert.equal(readLog().length, 1);
  });

  test('markContractViolationsSuperseded hides older rows from recentViolations', () => {
    logViolation('contract-a', 'output', ['x'], { x: 1 }, { repoRoot: tmpRoot });
    assert.equal(recentViolations({ repoRoot: tmpRoot }).length, 1);
    markContractViolationsSuperseded({ repoRoot: tmpRoot, reason: 'test supersede' });
    assert.ok(readViolationSupersedeCutoff(tmpRoot) > 0);
    assert.equal(recentViolations({ repoRoot: tmpRoot }).length, 0);
  });
});
