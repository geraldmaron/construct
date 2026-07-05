/**
 * tests/doctor-command-on-path.test.mjs
 *
 * resolveCommandOnPath (lib/doctor/command-on-path.mjs) backs cmdDoctor's
 * PATH lookups. If the outer zsh spawn itself fails with ENOENT (zsh not
 * installed), every dependent check must still get a real answer via the sh
 * fallback rather than reporting a false "not on PATH". Injects a fake
 * spawnSyncImpl to simulate zsh's ENOENT deterministically — a real
 * OS-level absent-zsh fixture is unreliable because macOS's path_helper
 * re-adds standard dirs once a login shell actually starts, which only
 * matters after the outer exec already succeeded or failed.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCommandOnPath } from '../lib/doctor/command-on-path.mjs';

test('falls back to sh when the outer zsh spawn fails with ENOENT', () => {
  const calls = [];
  const spawnSyncImpl = (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === 'zsh') return { error: Object.assign(new Error('spawnSync zsh ENOENT'), { code: 'ENOENT' }) };
    if (cmd === 'sh') return { status: 0, stdout: '/usr/local/bin/construct\n' };
    throw new Error(`unexpected command ${cmd}`);
  };

  const result = resolveCommandOnPath('construct', { spawnSyncImpl });

  assert.equal(calls.length, 2, 'must try zsh, then fall back to sh');
  assert.equal(calls[0][0], 'zsh');
  assert.equal(calls[1][0], 'sh');
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '/usr/local/bin/construct');
});

test('uses the zsh result directly when zsh is available (no spurious sh fallback)', () => {
  const calls = [];
  const spawnSyncImpl = (cmd, args) => {
    calls.push([cmd, args]);
    return { status: 0, stdout: '/usr/local/bin/construct\n' };
  };

  const result = resolveCommandOnPath('construct', { spawnSyncImpl });

  assert.equal(calls.length, 1, 'zsh succeeding must not trigger a second sh spawn');
  assert.equal(result.status, 0);
});

test('a genuine command-not-found (zsh present, command missing) is not masked as an ENOENT fallback', () => {
  const calls = [];
  const spawnSyncImpl = (cmd) => {
    calls.push(cmd);
    return { status: 1, stdout: '' };
  };

  const result = resolveCommandOnPath('does-not-exist', { spawnSyncImpl });

  assert.equal(calls.length, 1, 'zsh reporting a clean non-zero exit must not trigger the sh fallback');
  assert.equal(result.status, 1);
});

test('win32 uses `where` instead of zsh/sh', () => {
  const calls = [];
  const spawnSyncImpl = (cmd, args) => {
    calls.push([cmd, args]);
    return { status: 0, stdout: 'C:\\construct.exe\n' };
  };

  const result = resolveCommandOnPath('construct', { spawnSyncImpl, platform: 'win32' });

  assert.deepEqual(calls, [['where', ['construct']]]);
  assert.equal(result.status, 0);
});
