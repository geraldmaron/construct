/**
 * tests/service-manager.test.mjs — <one-line purpose>
 *
 * <2–6 line summary: what it does, who calls it, key side effects.>
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { clearDashboardState, readDashboardState, stopDashboard } from '../lib/service-manager.mjs';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('dashboard state is ignored when pid is no longer running', () => {
  const homeDir = tempDir('construct-service-home-');
  const runtimeDir = path.join(homeDir, '.construct', 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, 'dashboard.json'), `${JSON.stringify({ pid: 999999, port: 4242, url: 'http://127.0.0.1:4242' }, null, 2)}\n`);

  assert.equal(readDashboardState(homeDir), null);
});

test('stopDashboard clears stale state even when process is gone', () => {
  const homeDir = tempDir('construct-service-stop-');
  const runtimeDir = path.join(homeDir, '.construct', 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  const statePath = path.join(runtimeDir, 'dashboard.json');
  fs.writeFileSync(statePath, `${JSON.stringify({ pid: 999999, port: 4242, url: 'http://127.0.0.1:4242' }, null, 2)}\n`);

  const result = stopDashboard(homeDir);
  assert.equal(result.stopped, false);
  assert.equal(result.reason, 'stale-state');
  assert.equal(fs.existsSync(statePath), false);
});

test('clearDashboardState removes runtime state file', () => {
  const homeDir = tempDir('construct-service-clear-');
  const runtimeDir = path.join(homeDir, '.construct', 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  const statePath = path.join(runtimeDir, 'dashboard.json');
  fs.writeFileSync(statePath, '{}\n');

  clearDashboardState(homeDir);
  assert.equal(fs.existsSync(statePath), false);
});
