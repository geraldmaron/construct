/**
 * Spawn lib/server/index.mjs at a random port and hit every documented
 * /api/* endpoint. Assert each one returns a sane HTTP status (200 / 401 /
 * 404 are all considered shapes; 5xx is a regression). Catches blanket
 * breakage in the server's HTTP surface.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { withDashboardServer } from '../_lib/dashboard-server.mjs';

// Endpoints curated from the dashboard SPA's lib/api.ts surface. Read-only
// endpoints first; mutating endpoints are out of scope here (covered by
// dashboard-auth tests + manual smoke).

const READ_ENDPOINTS = [
  '/api/auth/status',
  '/api/status',
  '/api/registry',
  '/api/approvals',
  '/api/snapshots',
  '/api/artifacts',
  '/api/config',
  '/api/embed/status',
  '/api/embed/boundary',
  '/api/mode',
  '/api/alias',
  '/api/insights',
  '/api/project-config',
  '/api/overrides/agents',
  '/api/overrides/contracts',
  '/api/knowledge/index',
  '/api/knowledge/trends',
  '/api/terraform/files',
  '/api/models/providers',
  '/api/intake/config',
  '/api/intake/list',
  '/api/session-usage',
  '/api/providers?probe=0',
  '/api/providers/credentials',
  '/api/providers/credentials/op-status',
  '/api/providers/config-path',
  '/api/providers/billing',
  '/api/providers/subscriptions',
  '/api/audit?limit=10',
  '/api/workflow',
  '/api/doctor',
  '/api/recommendations',
  '/api/strategy',
  '/api/beads',
  '/api/performance/reviews',
  '/api/fs/browse',
];

test('dashboard server boots and serves every read endpoint', { timeout: 60_000 }, async (t) => {
  const ds = await withDashboardServer(t);
  if (!ds) return;

  const results = [];
  for (const path of READ_ENDPOINTS) {
    let status = 0;
    let bodyOk = false;
    try {
      const res = await ds.fetch(path);
      status = res.status;
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('json')) {
        await res.json();
        bodyOk = true;
      } else if (ct.includes('text')) {
        await res.text();
        bodyOk = true;
      } else {
        bodyOk = res.ok;
      }
    } catch (e) {
      results.push({ path, status, error: String(e) });
      continue;
    }
    results.push({ path, status, bodyOk });
  }

  const failures = results.filter((r) => r.status >= 500 || r.status === 0);
  assert.equal(failures.length, 0, `endpoints with 5xx / network failure:\n${JSON.stringify(failures, null, 2)}`);

  const auth = results.find((r) => r.path === '/api/auth/status');
  assert.ok(auth && auth.status === 200, `/api/auth/status must return 200, got ${auth?.status}`);
});

test('SPA index.html serves at /', { timeout: 30_000 }, async (t) => {
  const ds = await withDashboardServer(t);
  if (!ds) return;

  const res = await ds.fetch('/');
  assert.equal(res.status, 200);
  const ct = res.headers.get('content-type') ?? '';
  assert.match(ct, /html/i, `expected text/html, got ${ct}`);
  const body = await res.text();
  assert.match(body, /<!doctype html>/i, 'response must be an HTML document');
});

test('static asset path traversal is rejected', { timeout: 30_000 }, async (t) => {
  const ds = await withDashboardServer(t);
  if (!ds) return;

  const res = await ds.fetch('/../../etc/passwd');
  assert.ok([400, 403, 404].includes(res.status), `traversal attempt must be rejected; got ${res.status}`);
});
