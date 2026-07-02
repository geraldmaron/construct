/**
 * tests/providers/op-discovery.test.mjs — op CLI discovery tiers.
 *
 * Proves locateOpBinary resolves `op` through the process PATH, then a login-shell
 * probe, then well-known install dirs, and returns null only when it is absent from
 * all three — the fix for a GUI-launched host whose minimal PATH hides a real
 * Homebrew install. env/runShell/wellKnown are injected so no real 1Password CLI is
 * touched; the process-lifetime cache is reset before each case.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { locateOpBinary, __resetOpLocateCache } from '../../lib/providers/op-locate.mjs';

function makeFakeOp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-op-locate-'));
  const opBin = path.join(dir, process.platform === 'win32' ? 'op.exe' : 'op');
  fs.writeFileSync(opBin, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(opBin, 0o755);
  return { dir, opBin };
}

test('locateOpBinary finds op on the process PATH without a shell probe', (t) => {
  const { dir, opBin } = makeFakeOp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  __resetOpLocateCache();
  let shellCalls = 0;
  const found = locateOpBinary({
    fresh: true,
    env: { PATH: dir },
    runShell: () => { shellCalls += 1; return ''; },
  });
  assert.equal(found, opBin);
  assert.equal(shellCalls, 0, 'PATH tier resolved it, so the shell probe never ran');
});

test('locateOpBinary falls back to the login-shell probe when PATH misses', (t) => {
  const { dir, opBin } = makeFakeOp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  __resetOpLocateCache();
  const found = locateOpBinary({
    fresh: true,
    env: { PATH: '/cx-nonexistent-empty' },
    runShell: () => opBin,
    wellKnown: [],
  });
  assert.equal(found, opBin);
});

test('locateOpBinary falls back to a well-known install path when PATH and shell miss', (t) => {
  const { dir, opBin } = makeFakeOp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  __resetOpLocateCache();
  const found = locateOpBinary({
    fresh: true,
    env: { PATH: '/cx-nonexistent-empty' },
    runShell: () => '',
    wellKnown: [opBin],
  });
  assert.equal(found, opBin);
});

test('locateOpBinary returns null when op is absent from every tier', () => {
  __resetOpLocateCache();
  const found = locateOpBinary({
    fresh: true,
    env: { PATH: '/cx-nonexistent-empty' },
    runShell: () => '',
    wellKnown: ['/cx-nonexistent-empty/op'],
  });
  assert.equal(found, null);
});

test('locateOpBinary caches the first result and does not re-probe', (t) => {
  const { dir, opBin } = makeFakeOp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  __resetOpLocateCache();
  const first = locateOpBinary({ fresh: true, env: { PATH: dir }, runShell: () => '' });
  assert.equal(first, opBin);

  let shellCalls = 0;
  const second = locateOpBinary({ env: { PATH: '/cx-nonexistent-empty' }, runShell: () => { shellCalls += 1; return ''; } });
  assert.equal(second, opBin, 'cached path is returned despite the second call seeing an empty PATH');
  assert.equal(shellCalls, 0, 'no re-probe on a cache hit');
});
