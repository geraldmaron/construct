/**
 * tests/enterprise/tenant-scoping.test.mjs.
 *
 * tests/enterprise/tenant.test.mjs (H1) pins tenantId resolution/propagation
 * onto run/task records and the intake queue; tests/enterprise/audit-isolation.test.mjs
 * pins app-level cross-tenant filtering (scopeToTenant) as the stopgap
 * ahead of physical storage. These tests pin the H4 stage-1 slice: every new
 * team-mode Postgres table (orchestration runs, trace events, shared memory)
 * carries a queryable tenant_id column and every store query filters on it —
 * not as an app-level post-filter, but in the SQL WHERE clause itself, so a
 * tenant-B store instance never even fetches tenant A's rows — and resolving
 * any of these stores in enterprise mode with no resolvable tenant id fails
 * closed (throws) rather than defaulting into a shared bucket.
 *
 * No live Postgres is available in this environment; a minimal in-memory fake
 * `sql` tagged-template client backs the tests, mirroring the fakeSql
 * convention in tests/team-health.test.mjs, tests/db-migrations.test.mjs, and
 * tests/functional/shared-state.functional.test.mjs.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { PostgresRunStore } from '../../lib/orchestration/run-store-postgres.mjs';
import { resolveRunStore } from '../../lib/orchestration/store.mjs';
import { resolveTraceStore } from '../../lib/orchestration/trace-store.mjs';
import { resolveSharedMemoryStore } from '../../lib/storage/shared-memory.mjs';
import { TenantResolutionError } from '../../lib/tenant/context.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

function fakeRunsSql() {
  const rows = [];
  function query(strings, ...values) {
    const text = Array.isArray(strings) ? strings.join('?') : String(strings);
    if (/construct_schema_migrations/i.test(text)) return Promise.resolve([]);

    if (/INSERT INTO construct_orchestration_runs/i.test(text)) {
      const [runId, project, tenantId, createdAt, status, executionMode, payload] = values;
      const idx = rows.findIndex((r) => r.run_id === runId && r.project === project);
      const row = { run_id: runId, project, tenant_id: tenantId, created_at: createdAt, status, execution_mode: executionMode, payload };
      if (idx === -1) rows.push(row); else rows[idx] = row;
      return Promise.resolve([]);
    }
    if (/SELECT payload FROM construct_orchestration_runs\s+WHERE run_id/i.test(text)) {
      const [runId, project, tenantId] = values;
      return Promise.resolve(rows.filter((r) => r.run_id === runId && r.project === project && r.tenant_id === tenantId));
    }
    if (/SELECT payload FROM construct_orchestration_runs\s+WHERE project/i.test(text)) {
      const [project, tenantId] = values;
      return Promise.resolve(rows.filter((r) => r.project === project && r.tenant_id === tenantId));
    }
    return Promise.resolve([]);
  }
  query.unsafe = async () => {};
  query.begin = async (fn) => fn(query);
  query.json = (value) => value;
  return query;
}

test('PostgresRunStore scopes loadRun/listRuns by tenant — tenant A cannot read tenant B\'s run in the same project', async () => {
  const sql = fakeRunsSql();
  const storeA = new PostgresRunStore({ sql, project: 'acme', tenantId: 'tenant-a' });
  const storeB = new PostgresRunStore({ sql, project: 'acme', tenantId: 'tenant-b' });

  await storeA.saveRun({ runId: 'run-1', createdAt: '2026-01-01T00:00:00Z', status: 'completed', tasks: [] });

  const seenByA = await storeA.loadRun('run-1');
  assert.ok(seenByA, 'tenant A can read its own run');

  const seenByB = await storeB.loadRun('run-1');
  assert.equal(seenByB, null, 'tenant B must not read tenant A\'s run in the same project');

  const listA = await storeA.listRuns({});
  const listB = await storeB.listRuns({});
  assert.equal(listA.length, 1);
  assert.equal(listB.length, 0);
});

test('PostgresRunStore stamps the store\'s own tenantId on save regardless of a caller-supplied run.tenantId', async () => {
  const sql = fakeRunsSql();
  const store = new PostgresRunStore({ sql, project: 'acme', tenantId: 'tenant-a' });
  await store.saveRun({ runId: 'run-2', tenantId: 'spoofed-tenant', status: 'completed', tasks: [] });

  const other = new PostgresRunStore({ sql, project: 'acme', tenantId: 'spoofed-tenant' });
  assert.equal(await other.loadRun('run-2'), null, 'a run cannot be written into a different tenant than the store instance saving it');
  assert.ok(await store.loadRun('run-2'));
});

test('resolveRunStore fails closed for enterprise mode with no resolvable tenant', () => {
  assert.throws(
    () => resolveRunStore({
      config: {},
      env: {
        CONSTRUCT_DEPLOYMENT_MODE: 'enterprise',
        CONSTRUCT_ORCHESTRATION_STORE: 'postgres',
        DATABASE_URL: 'postgres://fake-host-never-connected/fake',
      },
      cwd: '/tmp/does-not-matter',
    }),
    TenantResolutionError,
  );
});

test('resolveRunStore resolves a tenant-scoped postgres store for enterprise mode with a resolvable tenant', () => {
  const result = resolveRunStore({
    config: {},
    env: {
      CONSTRUCT_DEPLOYMENT_MODE: 'enterprise',
      CONSTRUCT_ORCHESTRATION_STORE: 'postgres',
      CONSTRUCT_TENANT_ID: 'acme-corp',
      DATABASE_URL: 'postgres://fake-host-never-connected/fake',
    },
    cwd: '/tmp/does-not-matter',
  });
  assert.equal(result.backend, 'postgres');
  assert.equal(result.tenantId, 'acme-corp');
});

test('resolveTraceStore fails closed for enterprise mode with no resolvable tenant', () => {
  assert.throws(
    () => resolveTraceStore({ env: { CONSTRUCT_DEPLOYMENT_MODE: 'enterprise' }, sql: fakeRunsSql() }),
    TenantResolutionError,
  );
});

test('resolveTraceStore succeeds for enterprise mode with a resolvable tenant and scopes to it', async () => {
  const sql = fakeRunsSql();
  const store = resolveTraceStore({ env: { CONSTRUCT_DEPLOYMENT_MODE: 'enterprise', CONSTRUCT_TENANT_ID: 'acme-corp' }, sql });
  assert.equal(store.kind, 'postgres');
  assert.equal(store.tenantId, 'acme-corp');
});

test('resolveSharedMemoryStore fails closed for enterprise mode with no resolvable tenant', () => {
  assert.throws(
    () => resolveSharedMemoryStore({ env: { CONSTRUCT_DEPLOYMENT_MODE: 'enterprise' }, sql: fakeRunsSql() }),
    TenantResolutionError,
  );
});

test('resolveSharedMemoryStore succeeds for enterprise mode with a resolvable tenant and scopes to it', async () => {
  const sql = fakeRunsSql();
  const store = resolveSharedMemoryStore({ env: { CONSTRUCT_DEPLOYMENT_MODE: 'enterprise', CONSTRUCT_TENANT_ID: 'acme-corp' }, sql });
  assert.equal(store.kind, 'postgres');
  assert.equal(store.tenantId, 'acme-corp');
});

test('the new team-mode migrations carry a tenant_id column', () => {
  for (const file of ['004_trace_events.sql', '005_shared_memory.sql', '006_orchestration_runs_tenant.sql']) {
    const sql = fs.readFileSync(join(ROOT, 'lib', 'db', 'migrations', file), 'utf8');
    assert.match(sql, /tenant_id/i, `${file} must carry a tenant_id column`);
  }
});

test('a comment documents the stage-2 (physical isolation) deferral', () => {
  for (const file of [
    'lib/orchestration/run-store-postgres.mjs',
    'lib/orchestration/trace-store.mjs',
    'lib/storage/shared-memory.mjs',
  ]) {
    const source = fs.readFileSync(join(ROOT, file), 'utf8');
    assert.match(source, /[Ss]tage 2/, `${file} must document the stage-2 deferral`);
    assert.match(source, /deferred/i, `${file} must state the deferral explicitly`);
  }
});
