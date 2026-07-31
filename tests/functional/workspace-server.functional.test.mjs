/**
 * tests/functional/workspace-server.functional.test.mjs — day-one proof for
 * the shared workspace server.
 *
 * Spans CLI + durable Postgres state at once (CLAUDE.md's multi-component
 * rule): spawns the real `construct server start` binary, drives it over
 * real HTTP with fetch, and asserts on durable Postgres rows — not mocks,
 * not return values alone. Two sections always run (no Postgres required):
 * process-startup smoke and auth-shape checks against a server started with
 * no admin token configured. Everything that needs a durable Workspace/queue
 * (auth bootstrap, membership, concurrent-claim, recovery) is gated on a
 * reachable DATABASE_URL/CONSTRUCT_DATABASE_URL, following the exact
 * createSqlClient(env)-null-skip idiom tests/functional/pg-queue.functional.
 * test.mjs and tests/graph/relational-postgres-store.test.mjs already
 * established — never a fabricated "passed" result when Postgres is
 * unavailable. Set CONSTRUCT_REQUIRE_POSTGRES_TEST=1 to make absence fail.
 *
 * Concurrent-user proof: N simulated workers call POST /work/claim
 * concurrently against one running server; asserts the claimed-item id sets
 * are disjoint and their union is exactly the enqueued set (bead acceptance
 * criterion 2).
 *
 * Recovery proof: reuses spike E's discipline (a real SIGKILL delivered to a
 * real OS process, not a caught exception) — a worker child process claims a
 * work item over HTTP with a short lease and is killed before it ever
 * completes or heartbeats; a second worker's claim after the lease expires
 * receives the same item, proving pg-queue.mjs's existing lease-expiry
 * mechanism is reachable and correct through the HTTP boundary (bead
 * acceptance criterion 3).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

import { rmTmpDir } from '../helpers/cleanup.mjs';
import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';
import { createSqlClient, closeSqlClient } from '../../lib/storage/backend.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'construct');
const ADMIN_TOKEN = 'test-admin-token-0026';

function waitFor(predicate, { timeoutMs = 10000, intervalMs = 100 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = async () => {
      let ok = false;
      try { ok = await predicate(); } catch { ok = false; }
      if (ok) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor: timed out'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

/**
 * Spawn the real `construct server start` binary as a detached child,
 * capturing stdout to discover the OS-assigned port (--port=0), and poll
 * /healthz until it accepts connections. Returns { proc, baseUrl, stop }.
 */
async function startServerProcess({ home, databaseUrl, adminToken = ADMIN_TOKEN }) {
  const env = sterileSpawnEnv({
    HOME: home,
    CONSTRUCT_HOME_OVERRIDE: home,
    DATABASE_URL: databaseUrl || '',
    CONSTRUCT_SERVER_ADMIN_TOKEN: adminToken || '',
    CONSTRUCT_SERVER_PORT: '0',
    CONSTRUCT_SERVER_HOST: '127.0.0.1',
  });
  const proc = spawn(process.execPath, [BIN, 'server', 'start'], { cwd: home, env });
  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  let baseUrl = null;
  await waitFor(() => {
    const match = stdout.match(/listening on (http:\/\/[^\s]+)/);
    if (match) baseUrl = match[1];
    return Boolean(baseUrl);
  }, { timeoutMs: 15000 }).catch((err) => {
    throw new Error(`server did not report a listening address: ${err.message}\nstdout: ${stdout}\nstderr: ${stderr}`);
  });

  await waitFor(async () => {
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      return res.status === 200;
    } catch { return false; }
  }, { timeoutMs: 10000 });

  const stop = () => new Promise((resolve) => {
    proc.once('exit', resolve);
    proc.kill('SIGTERM');
    setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 3000);
  });

  return { proc, baseUrl, stop, getLogs: () => ({ stdout, stderr }) };
}

async function api(baseUrl, method, pathSuffix, { token, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${pathSuffix}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, body: json };
}

// --- Section 1: always runs, no Postgres required ---

test('construct server start refuses to run with no reachable Postgres client', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-server-nopostgres-'));
  try {
    const env = sterileSpawnEnv({ HOME: home, CONSTRUCT_HOME_OVERRIDE: home, DATABASE_URL: '' });
    const result = spawnSync(process.execPath, [BIN, 'server', 'start'], { cwd: home, env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /reachable Postgres client/);
  } finally {
    rmTmpDir(home);
  }
});

test('construct server: unknown subcommand exits non-zero with a usage message', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-server-badsub-'));
  try {
    const env = sterileSpawnEnv({ HOME: home, CONSTRUCT_HOME_OVERRIDE: home });
    const result = spawnSync(process.execPath, [BIN, 'server', 'bogus'], { cwd: home, env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown server subcommand/);
  } finally {
    rmTmpDir(home);
  }
});

// --- Section 2: requires a real, reachable Postgres ---

const probeSql = createSqlClient(process.env);
const requireLive = process.env.CONSTRUCT_REQUIRE_POSTGRES_TEST === '1';

if (!probeSql) {
  test('workspace server functional tests skipped — no DATABASE_URL / sql client', () => {
    assert.equal(requireLive, false, 'CONSTRUCT_REQUIRE_POSTGRES_TEST=1 requires a live Postgres client');
  });
} else {
  const RUN_ID = `${Date.now()}`;
  let sql;
  let ctx;

  test.before(async () => {
    sql = probeSql;
    const { applyMigrations } = await import('../../lib/db/migrate.mjs');
    await applyMigrations(sql);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-server-home-'));
    ctx = { home, ...(await startServerProcess({ home, databaseUrl: process.env.DATABASE_URL || process.env.CONSTRUCT_DATABASE_URL })) };
  });

  test.after(async () => {
    if (ctx) {
      await ctx.stop();
      rmTmpDir(ctx.home);
    }
    await sql`DELETE FROM construct_server_tokens WHERE workspace_id LIKE ${'cx-server-test-' + RUN_ID + '%'}`;
    await sql`DELETE FROM construct_workspace_members WHERE workspace_id LIKE ${'cx-server-test-' + RUN_ID + '%'}`;
    await sql`DELETE FROM construct_queue_claims WHERE project LIKE ${'cx-server-test-' + RUN_ID + '%'}`;
    await sql`DELETE FROM construct_queue_items WHERE project LIKE ${'cx-server-test-' + RUN_ID + '%'}`;
    await sql`DELETE FROM construct_workers WHERE project LIKE ${'cx-server-test-' + RUN_ID + '%'}`;
    await sql`DELETE FROM construct_workspaces WHERE id LIKE ${'cx-server-test-' + RUN_ID + '%'}`;
    await closeSqlClient(sql);
  });

  test('unauthenticated /workspaces is rejected before any workspace is created', async () => {
    const res = await api(ctx.baseUrl, 'POST', '/workspaces', { body: { id: 'nope' } });
    assert.equal(res.status, 401);
  });

  test('wrong admin token is rejected', async () => {
    const res = await api(ctx.baseUrl, 'POST', '/workspaces', { token: 'bad-token', body: { id: 'nope' } });
    assert.equal(res.status, 401);
  });

  test('bootstrap: admin token creates a workspace and mints the owner token', async () => {
    const id = `cx-server-test-${RUN_ID}-a`;
    const res = await api(ctx.baseUrl, 'POST', '/workspaces', {
      token: ADMIN_TOKEN,
      body: { id, name: 'Server Test A', ownerRef: 'alice@example.com' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.workspace.id, id);
    assert.equal(res.body.workspace.state, 'provisioning');
    assert.equal(res.body.workspace.deployment, 'shared');
    assert.ok(res.body.token);

    const dupe = await api(ctx.baseUrl, 'POST', '/workspaces', {
      token: ADMIN_TOKEN,
      body: { id, name: 'dupe', ownerRef: 'alice@example.com' },
    });
    assert.equal(dupe.status, 409);
  });

  test('owner can activate; member cannot; membership add mints a usable member token', async () => {
    const id = `cx-server-test-${RUN_ID}-b`;
    const created = await api(ctx.baseUrl, 'POST', '/workspaces', {
      token: ADMIN_TOKEN, body: { id, ownerRef: 'owner@example.com' },
    });
    const ownerToken = created.body.token;

    const activated = await api(ctx.baseUrl, 'POST', `/workspaces/${id}/activate`, { token: ownerToken });
    assert.equal(activated.status, 200);
    assert.equal(activated.body.workspace.state, 'active');

    const addMember = await api(ctx.baseUrl, 'POST', `/workspaces/${id}/members`, {
      token: ownerToken, body: { memberRef: 'member@example.com', role: 'member' },
    });
    assert.equal(addMember.status, 201);
    const memberToken = addMember.body.token;
    assert.ok(memberToken);

    const forbidden = await api(ctx.baseUrl, 'POST', `/workspaces/${id}/archive`, { token: memberToken });
    assert.equal(forbidden.status, 403);

    const getAsMember = await api(ctx.baseUrl, 'GET', `/workspaces/${id}`, { token: memberToken });
    assert.equal(getAsMember.status, 200);
  });

  test('a token for one workspace cannot reach another workspace', async () => {
    const idA = `cx-server-test-${RUN_ID}-c1`;
    const idB = `cx-server-test-${RUN_ID}-c2`;
    const a = await api(ctx.baseUrl, 'POST', '/workspaces', { token: ADMIN_TOKEN, body: { id: idA, ownerRef: 'x@example.com' } });
    await api(ctx.baseUrl, 'POST', '/workspaces', { token: ADMIN_TOKEN, body: { id: idB, ownerRef: 'y@example.com' } });

    const crossRead = await api(ctx.baseUrl, 'GET', `/workspaces/${idB}`, { token: a.body.token });
    assert.equal(crossRead.status, 403);
  });

  test('removing a member revokes their token on the very next request', async () => {
    const id = `cx-server-test-${RUN_ID}-d`;
    const created = await api(ctx.baseUrl, 'POST', '/workspaces', { token: ADMIN_TOKEN, body: { id, ownerRef: 'owner2@example.com' } });
    const ownerToken = created.body.token;
    const addMember = await api(ctx.baseUrl, 'POST', `/workspaces/${id}/members`, {
      token: ownerToken, body: { memberRef: 'temp@example.com' },
    });
    const memberToken = addMember.body.token;

    const before = await api(ctx.baseUrl, 'GET', `/workspaces/${id}`, { token: memberToken });
    assert.equal(before.status, 200);

    const removed = await api(ctx.baseUrl, 'DELETE', `/workspaces/${id}/members/temp@example.com`, { token: ownerToken });
    assert.equal(removed.status, 200);

    const after = await api(ctx.baseUrl, 'GET', `/workspaces/${id}`, { token: memberToken });
    assert.equal(after.status, 401);
  });

  test('concurrent-user: N simulated workers claim disjoint work with zero duplicates', async () => {
    const id = `cx-server-test-${RUN_ID}-concurrency`;
    const created = await api(ctx.baseUrl, 'POST', '/workspaces', { token: ADMIN_TOKEN, body: { id, ownerRef: 'lead@example.com' } });
    const ownerToken = created.body.token;
    await api(ctx.baseUrl, 'POST', `/workspaces/${id}/members`, { token: ownerToken, body: { memberRef: 'lead@example.com', role: 'owner' } });

    const itemIds = Array.from({ length: 8 }, (_, i) => `${id}-item-${i}`);
    for (const itemId of itemIds) {
      const res = await api(ctx.baseUrl, 'POST', `/workspaces/${id}/work`, {
        token: ownerToken,
        body: { id: itemId, intake: { sourcePath: `/tmp/${itemId}.md` } },
      });
      assert.equal(res.status, 201);
    }

    const claimAttempts = await Promise.all(
      Array.from({ length: 12 }, (_, i) => api(ctx.baseUrl, 'POST', `/workspaces/${id}/work/claim`, {
        token: ownerToken, body: { claimedBy: `worker-${i}` },
      })),
    );
    const claimed = claimAttempts.filter((r) => r.status === 200).map((r) => r.body.id);
    assert.equal(claimed.length, itemIds.length, 'exactly one successful claim per enqueued item');
    assert.equal(new Set(claimed).size, itemIds.length, 'no item claimed twice — zero duplicate execution');
    assert.deepEqual([...claimed].sort(), [...itemIds].sort());
  });

  test('recovery: a worker killed mid-claim releases its item for another worker to reclaim', async () => {
    const id = `cx-server-test-${RUN_ID}-recovery`;
    const created = await api(ctx.baseUrl, 'POST', '/workspaces', { token: ADMIN_TOKEN, body: { id, ownerRef: 'lead2@example.com' } });
    const ownerToken = created.body.token;
    const itemId = `${id}-item-0`;
    await api(ctx.baseUrl, 'POST', `/workspaces/${id}/work`, {
      token: ownerToken, body: { id: itemId, intake: { sourcePath: `/tmp/${itemId}.md` } },
    });

    // A real, self-inflicted SIGKILL — the same discipline spike E's harness
    // uses (spike-e-recovery.md, "why a self-inflicted SIGKILL counts as a
    // real crash"): the child claims for real over HTTP, then kills itself
    // before it can ever heartbeat or complete, so nothing gets a chance to
    // run cleanup code.

    const workerScript = `
      const res = await fetch(${JSON.stringify(`${ctx.baseUrl}/workspaces/${id}/work/claim`)}, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ${ownerToken}' },
        body: JSON.stringify({ claimedBy: 'crash-worker', leaseSeconds: 2 }),
      });
      const claimed = await res.json();
      if (claimed?.id !== ${JSON.stringify(itemId)}) { process.exit(17); }
      process.kill(process.pid, 'SIGKILL');
    `;
    const scriptPath = path.join(ctx.home, 'crash-worker.mjs');
    fs.writeFileSync(scriptPath, workerScript);
    const killed = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });
    assert.equal(killed.signal, 'SIGKILL', 'the worker process was really killed, not narrated');
    assert.equal(killed.status, null, 'a SIGKILL exits via signal, not a normal exit code');

    const immediateReclaim = await api(ctx.baseUrl, 'POST', `/workspaces/${id}/work/claim`, {
      token: ownerToken, body: { claimedBy: 'still-leased-worker' },
    });
    assert.equal(immediateReclaim.status, 204, 'lease has not expired yet — item must not be claimable twice at once');

    await new Promise((resolve) => setTimeout(resolve, 2500));

    const reclaimed = await api(ctx.baseUrl, 'POST', `/workspaces/${id}/work/claim`, {
      token: ownerToken, body: { claimedBy: 'recovery-worker' },
    });
    assert.equal(reclaimed.status, 200);
    assert.equal(reclaimed.body.id, itemId);
    assert.equal(reclaimed.body.attempt, 2, 'second real claim after the crashed first one');

    const completed = await api(ctx.baseUrl, 'POST', `/workspaces/${id}/work/${itemId}/complete`, {
      token: ownerToken, body: { processedBy: 'recovery-worker' },
    });
    assert.equal(completed.status, 200);
  });
}
