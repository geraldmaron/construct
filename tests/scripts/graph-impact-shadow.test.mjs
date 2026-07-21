/**
 * tests/scripts/graph-impact-shadow.test.mjs — self-test for TAP failure
 * attribution in scripts/graph-impact-shadow.mjs.
 *
 * parseTapFailedFiles() is the only place a shadow-mode run learns which
 * FILE a failing subtest belongs to (Node's tap reporter carries a
 * `location:` field only on failing subtests, verified against a real
 * `node --test --test-reporter=tap` run). These tests exercise the parser
 * against real TAP fixtures rather than a synthetic shape, since the
 * reporter's exact indentation/field layout is what the regexes depend on.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rmTmpDir } from '../helpers/cleanup.mjs';

import { parseTapFailedFiles } from '../../scripts/graph-impact-shadow.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

function runTap(fixtureDir, files) {
  // Strip NODE_TEST_CONTEXT/NODE_TEST_WORKER_ID: this file itself runs under
  // `node --test`, which sets them, and an inherited value flips the spawned
  // child into child-reporting mode with a different TAP shape (the same fix
  // applied in scripts/graph-impact-shadow.mjs's real spawnSync call).
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.NODE_TEST_WORKER_ID;
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', ...files],
    { cwd: fixtureDir, encoding: 'utf8', env: childEnv }
  );
  return result.stdout;
}

test('parseTapFailedFiles attributes a failure to its real file, not a passing one', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'shadow-tap-'));
  test.after(() => rmTmpDir(fixture));

  writeFileSync(path.join(fixture, 'a.test.mjs'), `
import test from 'node:test';
import assert from 'node:assert';
test('passes', () => assert.ok(true));
`);
  writeFileSync(path.join(fixture, 'b.test.mjs'), `
import test from 'node:test';
import assert from 'node:assert';
test('fails', () => assert.ok(false, 'boom'));
`);

  const tapOutput = runTap(fixture, ['a.test.mjs', 'b.test.mjs']);
  const failed = parseTapFailedFiles(tapOutput, fixture);
  assert.deepEqual(failed, ['b.test.mjs']);
});

test('parseTapFailedFiles returns an empty array when every test passes', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'shadow-tap-clean-'));
  test.after(() => rmTmpDir(fixture));

  writeFileSync(path.join(fixture, 'a.test.mjs'), `
import test from 'node:test';
import assert from 'node:assert';
test('passes', () => assert.ok(true));
`);

  const tapOutput = runTap(fixture, ['a.test.mjs']);
  assert.deepEqual(parseTapFailedFiles(tapOutput, fixture), []);
});

test('parseTapFailedFiles dedupes multiple failing subtests in the same file', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'shadow-tap-dedupe-'));
  test.after(() => rmTmpDir(fixture));

  writeFileSync(path.join(fixture, 'multi.test.mjs'), `
import test from 'node:test';
import assert from 'node:assert';
test('fails one', () => assert.ok(false));
test('fails two', () => assert.ok(false));
`);

  const tapOutput = runTap(fixture, ['multi.test.mjs']);
  assert.deepEqual(parseTapFailedFiles(tapOutput, fixture), ['multi.test.mjs']);
});

test('parseTapFailedFiles handles empty/garbage input without throwing', () => {
  assert.deepEqual(parseTapFailedFiles('', '/tmp'), []);
  assert.deepEqual(parseTapFailedFiles(null, '/tmp'), []);
  assert.deepEqual(parseTapFailedFiles('not tap at all\nrandom text', '/tmp'), []);
});
