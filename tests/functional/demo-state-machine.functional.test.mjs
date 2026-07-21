/**
 * tests/functional/demo-state-machine.functional.test.mjs — persisted demo state outcomes.
 *
 * Spawns the real construct demo CLI in an isolated tmpdir and asserts on the
 * durable state artifact under .construct/demos/state/.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { locateRecorder } from '../../lib/demo.mjs';
import { runDemoGuided } from '../../lib/demo-surface.mjs';
import { loadDemoState } from '../../lib/demo-state.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const BIN = path.join(REPO, 'bin', 'construct');

const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-state-home-'));
process.on('exit', () => rmTmpDir(SANDBOX_HOME));

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
      BOOTSTRAP_CHECKED: '1',
      CONSTRUCT_DISABLE_AUTO_CLEANUP: '1',
      HOME: SANDBOX_HOME,
      CONSTRUCT_HOME_OVERRIDE: SANDBOX_HOME,
    },
  });
}

test('guided demo with no recorder persists script-only state and ok:false', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-state-fn-'));
  try {
    const scriptDir = path.join(dir, 'templates', 'demos', 'scripts');
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.writeFileSync(path.join(scriptDir, 'fallback-demo.json'), JSON.stringify({
      name: 'fallback-demo',
      title: 'Fallback demo',
      steps: [{ title: 'One', prompt: 'Say hello', command: 'echo hello' }],
    }, null, 2));

    const result = await runDemoGuided('fallback-demo', {
      cwd: dir,
      repoRoot: dir,
      surface: 'tape',
      output: { write: () => {}, isTTY: false },
      errorOutput: { write: () => {} },
    });

    assert.equal(result.state, 'script-only');
    assert.equal(result.ok, false);
    const persisted = loadDemoState('fallback-demo', { cwd: dir });
    assert.ok(persisted);
    assert.equal(persisted.state, 'script-only');
    assert.notEqual(persisted.state, 'recorded');
    assert.notEqual(persisted.state, 'verified');
    assert.notEqual(persisted.state, 'certified');
  } finally {
    rmTmpDir(dir);
  }
});

test('construct demo record without recorder exits non-zero and persists unavailable', () => {
  if (locateRecorder()) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-state-rec-'));
  try {
    const result = run(['demo', 'record', 'quickstart', '--format', 'gif'], dir);
    assert.notEqual(result.status, 0, `record without recorder must not claim success: ${result.stderr}`);
    const persisted = loadDemoState('quickstart', { cwd: dir });
    assert.ok(persisted, 'expected persisted demo state');
    assert.equal(persisted.state, 'unavailable');
  } finally {
    rmTmpDir(dir);
  }
});

test('construct demo --source-only persists served state and exits 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-state-src-'));
  try {
    const result = run(['demo', 'quickstart', '--surface=tape', '--source-only'], dir);
    assert.equal(result.status, 0, result.stderr);
    const persisted = loadDemoState('quickstart', { cwd: dir });
    assert.ok(persisted);
    assert.equal(persisted.state, 'served');
  } finally {
    rmTmpDir(dir);
  }
});
