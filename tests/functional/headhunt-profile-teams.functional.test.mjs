/**
 * tests/functional/headhunt-profile-teams.functional.test.mjs
 *
 * @capability orchestration.routing
 *
 * Operations scope teams resolve at headhunt time — incident objectives
 * recommend reliability-team instead of unified-registry engineering-group ids.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runHeadhunt } from '../../lib/headhunt.mjs';
import { routeRequest } from '../../lib/orchestration-policy.mjs';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('operations scope headhunt recommends reliability-team for incident objectives', async (t) => {
  const cwd = tempDir('headhunt-profile-ops-');
  t.after(() => {
    try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {}
  });
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, 'construct.config.json'),
    `${JSON.stringify({ scope: 'operations' }, null, 2)}\n`,
    'utf8',
  );

  const result = await runHeadhunt({
    args: ['incident-response', '--for=investigate production outage and draft runbook', '--temp'],
    cwd,
    homeDir: tempDir('headhunt-profile-home-'),
  });

  assert.equal(result.overlay.recommendedTeam, 'operations-team');
  assert.equal(result.overlay.teamFocus, 'operations-team');
  assert.equal(result.overlay.scopeTeamSource, 'operations');

  const route = routeRequest({
    cwd,
    request: 'investigate production outage and draft runbook',
  });
  assert.equal(route.teamRouting.primaryTeam, 'operations-team');
});

test('operations scope routes implementation intent to engineering-team', (t) => {
  const cwd = tempDir('headhunt-profile-delivery-');
  t.after(() => {
    try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {}
  });
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, 'construct.config.json'),
    `${JSON.stringify({ scope: 'operations' }, null, 2)}\n`,
    'utf8',
  );

  const route = routeRequest({
    cwd,
    request: 'implement the queue retry fix and add regression tests',
  });
  assert.equal(route.teamRouting.primaryTeam, 'engineering-team');
  assert.ok(['implementation', 'fix'].includes(route.intent));
});
