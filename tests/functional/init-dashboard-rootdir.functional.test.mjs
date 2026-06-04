/**
 * tests/functional/init-dashboard-rootdir.functional.test.mjs
 *
 * Regression guard for construct-mzlo: `construct init` starts services with
 * rootDir = the PROJECT dir, but the dashboard/doctor entrypoints ship with the
 * install. startDashboard must resolve `lib/server/index.mjs` against the install
 * root (not the project) and confirm the port binds before returning — a dead URL
 * for a MODULE_NOT_FOUND crash must never be advertised.
 *
 * The real dashboard (no mock) is spawned from a project rootDir in an isolated
 * HOME, then asserted to actually serve.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { startDashboard, stopDashboard, readDashboardState } from '../../lib/service-manager.mjs';

test('startDashboard binds a live server when called with a project rootDir', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-dash-rootdir-'));
  const project = path.join(work, 'proj');
  const home = path.join(work, 'home');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(path.join(home, '.construct'), { recursive: true });

  try {
    const result = await startDashboard({ rootDir: project, homeDir: home, preferredPort: 4367 });

    assert.equal(result.failed, undefined, `dashboard failed to bind: ${result.error}\n${result.logTail || ''}`);
    assert.equal(result.started, true);
    assert.ok(result.url);

    const status = await fetch(`${result.url}/api/auth/status`).then((r) => r.status).catch(() => 0);
    assert.ok([200, 401, 403].includes(status), `dashboard not reachable, got ${status}`);

    const state = readDashboardState(home);
    assert.ok(state && state.url === result.url, 'state persisted only after readiness');
  } finally {
    try { stopDashboard(home); } catch { /* ignore */ }
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
