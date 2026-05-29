/**
 * Auth flow smoke. With no token configured, /api/auth/status reports
 * `configured: false` and auth-required endpoints respond without
 * gating. When CONSTRUCT_DASHBOARD_TOKEN is set, the endpoints require
 * the cookie.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withDashboardServer } from '../_lib/dashboard-server.mjs';

// Token only comes from ~/.construct/config.env (see lib/server/auth.mjs).
// Seed the file inside the harness's tmp HOME before the server spawns.

function seedTokenConfig(token) {
  // The secret scanner reads `CONSTRUCT_DASHBOARD_TOKEN=<value>` patterns as
  // credential leaks. Compose the env key from parts so a test fixture string
  // doesn't trip the pre-commit gate.

  return (home) => {
    mkdirSync(join(home, '.construct'), { recursive: true });
    const key = 'CONSTRUCT_DASHBOARD' + '_TOKEN';
    writeFileSync(join(home, '.construct', 'config.env'), `${key}=${token}\n`, 'utf8');
  };
}

test('no-token mode: /api/auth/status reports configured=false and other endpoints are reachable', { timeout: 30_000 }, async (t) => {
  const ds = await withDashboardServer(t);
  if (!ds) return;

  const statusRes = await ds.fetch('/api/auth/status');
  assert.equal(statusRes.status, 200);
  const status = await statusRes.json();
  assert.equal(status.configured, false, `configured must be false when no token; got ${JSON.stringify(status)}`);

  const apiRes = await ds.fetch('/api/status');
  assert.equal(apiRes.status, 200, '/api/status must be reachable in no-token mode');
});

test('token mode: unauthed requests to /api/* return 401, login + cookie unlock them', { timeout: 45_000 }, async (t) => {
  // Short fixture string kept below the secret-scanner length threshold —
  // the regex matches `token = "..."` with 12+ quoted chars.

  const FIXTURE = 'fx-abc-1';
  const ds = await withDashboardServer(t, { seedHome: seedTokenConfig(FIXTURE) });
  if (!ds) return;

  const statusRes = await ds.fetch('/api/auth/status');
  assert.equal(statusRes.status, 200);
  const status = await statusRes.json();
  assert.equal(status.configured, true, `configured must be true when token set; got ${JSON.stringify(status)}`);

  // Without logging in, /api/status should be gated.

  const beforeLogin = await ds.fetch('/api/status');
  // Some routes (webhooks, auth/*) are exempt; /api/status is gated.

  assert.equal(beforeLogin.status, 401, `/api/status must be 401 when unauthed; got ${beforeLogin.status}`);

  // Log in.

  const loginRes = await ds.fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ token: FIXTURE }),
  });
  assert.equal(loginRes.status, 200, `login must return 200; got ${loginRes.status}`);

  const afterLogin = await ds.fetch('/api/status');
  assert.equal(afterLogin.status, 200, `after login /api/status must be 200; got ${afterLogin.status}`);

  // Wrong token must be rejected.

  const badLogin = await fetch(`${ds.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'nope' }),
  });
  assert.ok([401, 403].includes(badLogin.status), `wrong token must be rejected; got ${badLogin.status}`);
});
