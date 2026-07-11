/**
 * tests/scripts/run-tests-files-from.test.mjs — self-test for --files-from flag.
 *
 * Tests the --files-from=<path> flag composition with --exclude and --shard:
 *   1. filter reads a JSON file where each key is a test file path
 *   2. intersects with discovered tests AFTER --exclude, BEFORE --shard
 *   3. --list output reflects the intersection
 *   4. missing file exits with error
 *   5. invalid JSON exits with error
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNER = path.join('scripts', 'run-tests.mjs');

function runTests(cwd, extraArgs = []) {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, RUNNER), ...extraArgs, '--list'], {
    cwd,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    files: result.stdout.split('\n').filter(Boolean),
  };
}

test('--files-from=<path> intersects with discovered tests', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'files-from-'));
  test.after(() => rmTmpDir(fixture));

  mkdirSync(path.join(fixture, 'tests'), { recursive: true });
  writeFileSync(path.join(fixture, 'tests', '001.test.mjs'), 'export {};');
  writeFileSync(path.join(fixture, 'tests', '002.test.mjs'), 'export {};');
  writeFileSync(path.join(fixture, 'tests', '003.test.mjs'), 'export {};');

  const filterFile = path.join(fixture, 'filter.json');
  writeFileSync(filterFile, JSON.stringify({
    'tests/001.test.mjs': true,
    'tests/003.test.mjs': true,
  }));

  const result = runTests(fixture, [`--files-from=${filterFile}`]);
  assert.equal(result.status, 0);
  assert.deepEqual(result.files.sort(), ['tests/001.test.mjs', 'tests/003.test.mjs']);
});

test('--files-from applies after --exclude', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'files-from-exclude-'));
  test.after(() => rmTmpDir(fixture));

  mkdirSync(path.join(fixture, 'tests', 'functional'), { recursive: true });
  mkdirSync(path.join(fixture, 'tests', 'unit'), { recursive: true });
  writeFileSync(path.join(fixture, 'tests', 'unit', '001.test.mjs'), 'export {};');
  writeFileSync(path.join(fixture, 'tests', 'functional', '002.test.mjs'), 'export {};');
  writeFileSync(path.join(fixture, 'tests', 'functional', '003.test.mjs'), 'export {};');

  const filterFile = path.join(fixture, 'filter.json');
  writeFileSync(filterFile, JSON.stringify({
    'tests/unit/001.test.mjs': true,
    'tests/functional/002.test.mjs': true,
    'tests/functional/003.test.mjs': true,
  }));

  const result = runTests(fixture, [
    '--exclude=tests/functional',
    `--files-from=${filterFile}`,
  ]);
  assert.equal(result.status, 0);
  assert.deepEqual(result.files, ['tests/unit/001.test.mjs']);
});

test('--files-from composes with --shard', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'files-from-shard-'));
  test.after(() => rmTmpDir(fixture));

  mkdirSync(path.join(fixture, 'tests'), { recursive: true });
  for (let i = 1; i <= 6; i += 1) {
    writeFileSync(path.join(fixture, 'tests', `${String(i).padStart(3, '0')}.test.mjs`), 'export {};');
  }

  const filterFile = path.join(fixture, 'filter.json');
  writeFileSync(filterFile, JSON.stringify({
    'tests/001.test.mjs': true,
    'tests/002.test.mjs': true,
    'tests/003.test.mjs': true,
    'tests/004.test.mjs': true,
  }));

  const shard1 = runTests(fixture, [`--files-from=${filterFile}`, '--shard=1/2']);
  const shard2 = runTests(fixture, [`--files-from=${filterFile}`, '--shard=2/2']);

  assert.equal(shard1.status, 0);
  assert.equal(shard2.status, 0);

  const union = shard1.files.concat(shard2.files).sort();
  const expected = ['tests/001.test.mjs', 'tests/002.test.mjs', 'tests/003.test.mjs', 'tests/004.test.mjs'];
  assert.deepEqual(union, expected);

  const seen = new Set();
  for (const f of shard1.files) {
    assert.ok(!seen.has(f), `file ${f} in both shards`);
    seen.add(f);
  }
  for (const f of shard2.files) {
    assert.ok(!seen.has(f), `file ${f} in both shards`);
    seen.add(f);
  }
});

test('missing --files-from file exits with error', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'files-from-missing-'));
  test.after(() => rmTmpDir(fixture));

  mkdirSync(path.join(fixture, 'tests'), { recursive: true });
  writeFileSync(path.join(fixture, 'tests', '001.test.mjs'), 'export {};');

  const result = runTests(fixture, ['--files-from=/nonexistent/filter.json']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Failed to read/);
});

test('invalid JSON in --files-from file exits with error', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'files-from-invalid-json-'));
  test.after(() => rmTmpDir(fixture));

  mkdirSync(path.join(fixture, 'tests'), { recursive: true });
  writeFileSync(path.join(fixture, 'tests', '001.test.mjs'), 'export {};');

  const filterFile = path.join(fixture, 'filter.json');
  writeFileSync(filterFile, 'not valid json {');

  const result = runTests(fixture, [`--files-from=${filterFile}`]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Failed to read/);
});

test('--files-from=<path> can reference a path not discovered', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'files-from-nonexistent-'));
  test.after(() => rmTmpDir(fixture));

  mkdirSync(path.join(fixture, 'tests'), { recursive: true });
  writeFileSync(path.join(fixture, 'tests', '001.test.mjs'), 'export {};');

  const filterFile = path.join(fixture, 'filter.json');
  writeFileSync(filterFile, JSON.stringify({
    'tests/nonexistent.test.mjs': true,
  }));

  const result = runTests(fixture, [`--files-from=${filterFile}`]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No test files found|selected 0 of/);
});

test('--files-from with empty filter exits with error', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'files-from-empty-'));
  test.after(() => rmTmpDir(fixture));

  mkdirSync(path.join(fixture, 'tests'), { recursive: true });
  writeFileSync(path.join(fixture, 'tests', '001.test.mjs'), 'export {};');

  const filterFile = path.join(fixture, 'filter.json');
  writeFileSync(filterFile, JSON.stringify({}));

  const result = runTests(fixture, [`--files-from=${filterFile}`]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No test files found/);
});
