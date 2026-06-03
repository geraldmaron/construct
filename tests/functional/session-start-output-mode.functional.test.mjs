/**
 * tests/functional/session-start-output-mode.functional.test.mjs — end-to-end hook routing.
 *
 * Spawns the real SessionStart hook with a SessionStart payload on stdin and a
 * pinned HOME, and asserts the output contract: interactive emits context to
 * stdout; an explicit silent mode and an `auto` non-interactive signal (CI) keep
 * stdout empty while preserving the payload in the debug log; stderr mode routes
 * to stderr. The hook always exits 0 (non-blocking). This exercises the hook +
 * config-schema path together, which a unit test on the resolver cannot.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(HERE, '..', '..', 'lib', 'hooks', 'session-start.mjs');

function driveHook(extraEnv = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-ss-home-'));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-ss-proj-'));
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  const input = JSON.stringify({ cwd: proj, session_id: 'fn-test', source: 'startup' });
  // env -i-style minimal env: only PATH + HOME + the case under test, so an
  // ambient CI/NODE_ENV on the runner cannot perturb the interactive case.
  const res = spawnSync('node', [HOOK], {
    input,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, ...extraEnv },
  });
  const log = path.join(home, '.cx', 'session-start-last.log');
  const result = { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', logExists: fs.existsSync(log) };
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(proj, { recursive: true, force: true });
  return result;
}

test('interactive: context goes to stdout, exit 0', () => {
  const r = driveHook();
  assert.equal(r.status, 0);
  assert.ok(r.stdout.length > 0, 'stdout carries the context payload');
});

test('explicit silent: stdout stays empty, payload preserved in the debug log', () => {
  const r = driveHook({ CONSTRUCT_HOOK_OUTPUT_MODE: 'silent' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '', 'no context on stdout');
  assert.ok(r.logExists, 'payload preserved in debug log');
});

test('auto under CI suppresses stdout', () => {
  const r = driveHook({ CI: 'true' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '', 'non-interactive auto keeps stdout clean');
});

test('explicit stderr routes the payload to stderr, not stdout', () => {
  const r = driveHook({ CONSTRUCT_HOOK_OUTPUT_MODE: 'stderr' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.ok(r.stderr.length > 0, 'context on stderr');
});

test('explicit stdout overrides a non-interactive signal', () => {
  const r = driveHook({ CI: 'true', CONSTRUCT_HOOK_OUTPUT_MODE: 'stdout' });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.length > 0, 'explicit stdout wins over auto');
});
