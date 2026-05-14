/**
 * tests/first-invocation-probe.test.mjs — `maybeFirstInvocationProbe` matrix.
 *
 * The probe runs on the first user-initiated `construct <cmd>` invocation
 * after install. Pins the skip conditions (hooks, setup, uninstall, cached
 * BOOTSTRAP_CHECKED, non-TTY) so we never accidentally start prompting
 * mid-hook or in CI.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { maybeFirstInvocationProbe, shouldSkipProbe } from '../lib/install/first-invocation.mjs';
import { parseEnvFile } from '../lib/env-config.mjs';

let tmpHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-firstprobe-'));
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function fakeTty() { return { isTTY: true, on() {} }; }
function fakeNonTty() { return { isTTY: false, on() {} }; }

function probesAllHealthy() {
  return async () => [
    { id: 'node', displayName: 'Node ≥18', required: true, present: true, healthy: true },
    { id: 'git', displayName: 'git', required: false, present: true, healthy: true },
  ];
}

function probesMissingRequired() {
  return async () => [
    { id: 'node', displayName: 'Node ≥18', required: true, present: false },
    { id: 'docker', displayName: 'Docker', required: false, present: false, fallback: 'JSON vector index' },
  ];
}

function probesMissingOptional() {
  return async () => [
    { id: 'node', displayName: 'Node ≥18', required: true, present: true, healthy: true },
    { id: 'docker', displayName: 'Docker', required: false, present: false, fallback: 'JSON vector index' },
  ];
}

describe('shouldSkipProbe', () => {
  it('skips hook invocations (would corrupt hook output)', () => {
    assert.equal(shouldSkipProbe({ command: 'hook', env: {}, stdin: fakeTty() }), true);
  });
  it('skips setup, uninstall, version, help, doctor, completions', () => {
    for (const cmd of ['setup', 'uninstall', 'version', 'help', 'doctor', 'completions']) {
      assert.equal(shouldSkipProbe({ command: cmd, env: {}, stdin: fakeTty() }), true, cmd);
    }
  });
  it('skips when BOOTSTRAP_CHECKED=1 is in process env', () => {
    assert.equal(shouldSkipProbe({ command: 'doctor', env: { BOOTSTRAP_CHECKED: '1' }, stdin: fakeTty() }), true);
  });
  it('skips when CONSTRUCT_SKIP_BOOTSTRAP_PROBE=1', () => {
    assert.equal(shouldSkipProbe({ command: 'sync', env: { CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1' }, stdin: fakeTty() }), true);
  });
  it('runs for ordinary commands', () => {
    assert.equal(shouldSkipProbe({ command: 'sync', env: {}, stdin: fakeTty() }), false);
    assert.equal(shouldSkipProbe({ command: 'status', env: {}, stdin: fakeTty() }), false);
  });
  it('skips bare flags / no-command', () => {
    assert.equal(shouldSkipProbe({ command: '', env: {}, stdin: fakeTty() }), true);
    assert.equal(shouldSkipProbe({ command: '-h', env: {}, stdin: fakeTty() }), true);
    assert.equal(shouldSkipProbe({ command: '--version', env: {}, stdin: fakeTty() }), true);
  });
});

describe('maybeFirstInvocationProbe', () => {
  it('skips when BOOTSTRAP_CHECKED=1 cached in config.env (silent fast-path)', async () => {
    fs.mkdirSync(path.join(tmpHome, '.construct'), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.construct', 'config.env'), 'BOOTSTRAP_CHECKED=1\n');
    let probeCalled = false;
    const result = await maybeFirstInvocationProbe({
      command: 'sync',
      homeDir: tmpHome,
      env: {},
      stdin: fakeTty(),
      stdout: { write() {} },
      probeAllFn: async () => { probeCalled = true; return []; },
    });
    assert.equal(result.ran, false);
    assert.equal(result.reason, 'already-checked');
    assert.equal(probeCalled, false, 'probe must not run when cached');
  });

  it('all-healthy run sets BOOTSTRAP_CHECKED=1 silently', async () => {
    const writes = [];
    const result = await maybeFirstInvocationProbe({
      command: 'sync',
      homeDir: tmpHome,
      env: {},
      stdin: fakeNonTty(),
      stdout: { write(line) { writes.push(line); } },
      probeAllFn: probesAllHealthy(),
    });
    assert.equal(result.ran, true);
    assert.equal(result.reason, 'all-healthy');
    assert.deepEqual(writes, [], 'silent on success');
    assert.equal(parseEnvFile(path.join(tmpHome, '.construct', 'config.env')).BOOTSTRAP_CHECKED, '1');
  });

  it('missing-optional + non-TTY: prints table, sets cache, does not prompt', async () => {
    const writes = [];
    const result = await maybeFirstInvocationProbe({
      command: 'sync',
      homeDir: tmpHome,
      env: {},
      stdin: fakeNonTty(),
      stdout: { write(line) { writes.push(line); } },
      probeAllFn: probesMissingOptional(),
    });
    assert.equal(result.ran, true);
    assert.equal(result.reason, 'reported-non-tty');
    assert.equal(result.runSetup, undefined);
    assert.ok(writes.join('').includes('Resource check'));
    assert.equal(parseEnvFile(path.join(tmpHome, '.construct', 'config.env')).BOOTSTRAP_CHECKED, '1');
  });

  it('missing-required + TTY: prints table, prompts, returns runSetup based on answer', async () => {
    const writes = [];
    const result = await maybeFirstInvocationProbe({
      command: 'sync',
      homeDir: tmpHome,
      env: {},
      stdin: fakeTty(),
      stdout: Object.assign({ write(line) { writes.push(line); } }, { isTTY: true }),
      probeAllFn: probesMissingRequired(),
      readlineModule: {
        createInterface() {
          return { question(_q, cb) { cb('y'); }, close() {} };
        },
      },
    });
    assert.equal(result.ran, true);
    assert.equal(result.reason, 'prompted');
    assert.equal(result.runSetup, true);
    assert.ok(writes.join('').includes('required resource(s) missing'));
    assert.equal(parseEnvFile(path.join(tmpHome, '.construct', 'config.env')).BOOTSTRAP_CHECKED, '1');
  });

  it('hook invocation: never runs probe regardless of state (silent for hooks)', async () => {
    let probeCalled = false;
    const writes = [];
    const result = await maybeFirstInvocationProbe({
      command: 'hook',
      homeDir: tmpHome,
      env: {},
      stdin: fakeTty(),
      stdout: { write(line) { writes.push(line); } },
      probeAllFn: async () => { probeCalled = true; return []; },
    });
    assert.equal(result.ran, false);
    assert.equal(probeCalled, false);
    assert.deepEqual(writes, [], 'hooks must produce zero probe output');
  });
});
