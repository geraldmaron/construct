/**
 * tests/scripts/run-tests-shard.test.mjs — self-test for the test runner's
 * --shard striping (scripts/test-shard.mjs + scripts/run-tests.mjs).
 *
 * Invariants under test:
 *   1. stripes are pairwise disjoint, their union is the full input list, and
 *      shard sizes differ by at most one (partition correctness);
 *   2. striping is deterministic — same input, same stripe;
 *   3. both --shard=i/n and the two-token --shard i/n forms parse and are
 *      spliced out of argv so nothing leaks to `node --test`;
 *   4. at the spawn level, an invalid spec and an empty shard both exit 1, and
 *      `--list` output across shards 1..n reassembles the unsharded list.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { rmTmpDir } from '../helpers/cleanup.mjs';

import { parseShardArgs, parseShardSpec, stripeFiles } from '../../scripts/test-shard.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNER = path.join('scripts', 'run-tests.mjs');

function syntheticFiles(count) {
  return Array.from({ length: count }, (_, i) => `tests/${String(i).padStart(3, '0')}.test.mjs`);
}

test('stripes form a partition: disjoint, union = full list, sizes differ by at most 1', () => {
  for (const [count, total] of [[10, 3], [9, 3], [1, 4], [7, 1], [12, 5]]) {
    const files = syntheticFiles(count);
    const stripes = Array.from({ length: total }, (_, i) => stripeFiles(files, i + 1, total));

    const union = stripes.flat().sort();
    assert.deepEqual(union, files, `union of ${total} stripes over ${count} files must be the full list`);

    const seen = new Set();
    for (const stripe of stripes) {
      for (const f of stripe) {
        assert.ok(!seen.has(f), `file ${f} appeared in two stripes (${count} files / ${total} shards)`);
        seen.add(f);
      }
    }

    const sizes = stripes.map((s) => s.length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `stripe sizes ${sizes} differ by more than 1`);
  }
});

test('striping is deterministic and order-preserving', () => {
  const files = syntheticFiles(11);
  const first = stripeFiles(files, 2, 3);
  const second = stripeFiles(files, 2, 3);
  assert.deepEqual(first, second);
  assert.deepEqual(first, [...first].sort(), 'a stripe of a sorted list stays sorted');
});

test('shard 1/1 selects every file', () => {
  const files = syntheticFiles(6);
  assert.deepEqual(stripeFiles(files, 1, 1), files);
});

test('parseShardArgs consumes --shard=i/n and splices it out of argv', () => {
  const args = ['--exclude=tests/functional', '--shard=2/3'];
  const spec = parseShardArgs(args);
  assert.deepEqual(spec, { index: 2, total: 3 });
  assert.deepEqual(args, ['--exclude=tests/functional']);
});

test('parseShardArgs consumes the two-token --shard i/n form', () => {
  const args = ['--shard', '1/3', '--test-reporter=spec'];
  const spec = parseShardArgs(args);
  assert.deepEqual(spec, { index: 1, total: 3 });
  assert.deepEqual(args, ['--test-reporter=spec']);
});

test('parseShardArgs returns null when no shard flag is present', () => {
  const args = ['--exclude=tests/functional'];
  assert.equal(parseShardArgs(args), null);
  assert.deepEqual(args, ['--exclude=tests/functional']);
});

test('invalid shard specs throw', () => {
  for (const bad of ['abc', '3', '0/3', '4/3', '1/0', '-1/3', '1/3/5', '1.5/3', '', undefined]) {
    assert.throws(() => parseShardSpec(bad), /Invalid --shard spec/, `spec ${JSON.stringify(bad)} must throw`);
  }
});

test('run-tests.mjs exits 1 on an invalid --shard spec', () => {
  for (const bad of ['--shard=abc', '--shard=0/3', '--shard=4/3']) {
    const result = spawnSync(process.execPath, [RUNNER, bad, '--list'], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(result.status, 1, `${bad} must exit 1`);
    assert.match(result.stderr, /Invalid --shard spec/);
  }
});

test('run-tests.mjs exits 1 when a shard selects zero files', () => {
  const result = spawnSync(process.execPath, [RUNNER, '--shard=9999/9999', '--list'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /selected 0 of \d+ test files/);
});

test('spawned --list stripes across shards 1..3 reassemble the full unsharded list', () => {
  // Hermetic fixture tree, NOT the live repo: striping is index-modulo over
  // the sorted discovery list, so a concurrently-running repo test that
  // creates or removes files under tests/ between the four spawns shifts
  // every index and breaks the union (observed as a deterministic shard-3 CI
  // failure — this test shares a shard with tests that churn the tree). A
  // private cwd gives all four spawns one immutable list.
  const fixture = mkdtempSync(path.join(tmpdir(), 'shard-list-'));
  test.after(() => rmTmpDir(fixture));
  mkdirSync(path.join(fixture, 'tests'), { recursive: true });
  for (let i = 0; i < 10; i += 1) {
    writeFileSync(path.join(fixture, 'tests', `${String(i).padStart(2, '0')}.test.mjs`), 'export {};\n');
  }
  const list = (extraArgs) => {
    const result = spawnSync(process.execPath, [path.join(REPO_ROOT, RUNNER), ...extraArgs, '--list'], { cwd: fixture, encoding: 'utf8' });
    assert.equal(result.status, 0, `--list run failed: ${result.stderr}`);
    return result.stdout.split('\n').filter(Boolean);
  };

  const full = list([]);
  assert.equal(full.length, 10, 'the fixture must enumerate exactly its ten synthetic test files');

  const stripes = [1, 2, 3].map((i) => list([`--shard=${i}/3`]));
  assert.deepEqual(stripes.flat().sort(), [...full].sort(), 'union of shards 1..3 must equal the full list');

  const seen = new Set();
  for (const stripe of stripes) {
    for (const f of stripe) {
      assert.ok(!seen.has(f), `file ${f} selected by two shards`);
      seen.add(f);
    }
  }
});
