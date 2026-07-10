/**
 * tests/functional/certification-runner.functional.test.mjs — end-to-end construct certify run.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const BIN = path.join(REPO, 'bin', 'construct');

test('construct certify run executes a hermetic scenario in an isolated project', (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'certify-functional-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'certify-functional-home-'));
  t.after(() => {
    rmTmpDir(rootDir);
    rmTmpDir(home);
  });
  fs.mkdirSync(path.join(rootDir, '.construct'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'package.json'), '{}\n');

  const result = spawnSync(BIN, ['certify', 'run', 'artifact.release-gate.prd'], {
    cwd: rootDir,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CX_HOME_OVERRIDE: home },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const runsDir = path.join(rootDir, '.construct', 'certification', 'runs');
  assert.ok(fs.existsSync(runsDir));
  const runDirs = fs.readdirSync(runsDir);
  assert.ok(runDirs.length >= 1);
  const run = JSON.parse(fs.readFileSync(path.join(runsDir, runDirs[0], 'run.json'), 'utf8'));
  assert.equal(run.verdict.status, 'pass');
});
