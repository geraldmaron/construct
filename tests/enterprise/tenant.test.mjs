/**
 * tests/enterprise/tenant.test.mjs — tenant context resolution (LMCP-H1).
 *
 * Pins ADR-0057 (A7) IMPLEMENT-NOW behavior: tenantId is resolved once from
 * config+env, validated against deployment mode, and propagated onto
 * orchestration run/task records and the intake queue factory. Solo/team
 * default to the explicit tenant 'local'; enterprise mode with no resolvable
 * tenant fails closed with an actionable error, at both plan time and
 * resume/execute time.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  resolveTenantContext,
  requireTenantContext,
  TenantResolutionError,
  TENANT_ID_ENV_KEY,
  DEFAULT_TENANT_ID,
} from '../../lib/tenant/context.mjs';
import { validateTenantAtStartup } from '../../lib/deployment-mode.mjs';
import { createIntakeQueue } from '../../lib/intake/queue.mjs';
import { planRun, executeRun } from '../../lib/orchestration/runtime.mjs';

const MODEL = 'anthropic/claude-sonnet-4-6';
const BASE_ENV = { CX_MODEL_REASONING: MODEL, CX_MODEL_STANDARD: MODEL, CX_MODEL_FAST: MODEL };

const dirs = [];
function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-tenant-'));
  dirs.push(cwd);
  return cwd;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

test('solo mode defaults to the explicit tenant "local"', () => {
  const result = resolveTenantContext({ env: {}, mode: 'solo' });
  assert.equal(result.tenantId, DEFAULT_TENANT_ID);
  assert.equal(result.source, 'default');
});

test('team mode defaults to the explicit tenant "local"', () => {
  const result = resolveTenantContext({ env: {}, mode: 'team' });
  assert.equal(result.tenantId, DEFAULT_TENANT_ID);
  assert.equal(result.source, 'default');
});

test('an explicit env tenant id wins over the default in solo/team', () => {
  const result = resolveTenantContext({ env: { [TENANT_ID_ENV_KEY]: 'acme' }, mode: 'team' });
  assert.equal(result.tenantId, 'acme');
  assert.equal(result.source, 'env');
});

test('config-sourced tenantId is used when env is absent', () => {
  const result = resolveTenantContext({
    env: {},
    config: { deployment: { tenantId: 'from-config' } },
    mode: 'solo',
  });
  assert.equal(result.tenantId, 'from-config');
  assert.equal(result.source, 'config');
});

test('env tenant id wins over config when both are present', () => {
  const result = resolveTenantContext({
    env: { [TENANT_ID_ENV_KEY]: 'from-env' },
    config: { deployment: { tenantId: 'from-config' } },
    mode: 'enterprise',
  });
  assert.equal(result.tenantId, 'from-env');
  assert.equal(result.source, 'env');
});

test('enterprise mode with a resolvable tenant succeeds', () => {
  const result = resolveTenantContext({ env: { [TENANT_ID_ENV_KEY]: 'acme-corp' }, mode: 'enterprise' });
  assert.equal(result.tenantId, 'acme-corp');
  assert.equal(result.mode, 'enterprise');
});

test('enterprise mode with no tenant configured fails closed with an actionable error', () => {
  assert.throws(
    () => resolveTenantContext({ env: {}, mode: 'enterprise' }),
    (err) => {
      assert.ok(err instanceof TenantResolutionError);
      assert.match(err.message, /enterprise mode requires a resolvable tenant id/);
      assert.match(err.message, /CONSTRUCT_TENANT_ID/);
      return true;
    },
  );
});

test('enterprise mode with a blank/whitespace tenant id still fails closed', () => {
  assert.throws(
    () => resolveTenantContext({ env: { [TENANT_ID_ENV_KEY]: '   ' }, mode: 'enterprise' }),
    TenantResolutionError,
  );
  assert.throws(
    () => resolveTenantContext({
      env: {},
      config: { deployment: { tenantId: '' } },
      mode: 'enterprise',
    }),
    TenantResolutionError,
  );
});

test('requireTenantContext mirrors resolveTenantContext for startup guards', () => {
  assert.throws(() => requireTenantContext({ env: {}, mode: 'enterprise' }), TenantResolutionError);
  const ok = requireTenantContext({ env: { [TENANT_ID_ENV_KEY]: 't1' }, mode: 'enterprise' });
  assert.equal(ok.tenantId, 't1');
});

test('validateTenantAtStartup refuses enterprise startup with no tenant configured', () => {
  const cwd = project();
  fs.writeFileSync(
    path.join(cwd, 'construct.config.json'),
    JSON.stringify({ version: 1, deployment: { mode: 'enterprise' } }),
  );
  assert.throws(
    () => validateTenantAtStartup({ CONSTRUCT_DEPLOYMENT_MODE: 'enterprise' }, { cwd }),
    (err) => {
      assert.ok(err instanceof TenantResolutionError);
      assert.match(err.message, /enterprise mode requires a resolvable tenant id/);
      return true;
    },
  );
});

test('validateTenantAtStartup succeeds for enterprise mode with CONSTRUCT_TENANT_ID set', () => {
  const cwd = project();
  const result = validateTenantAtStartup(
    { CONSTRUCT_DEPLOYMENT_MODE: 'enterprise', [TENANT_ID_ENV_KEY]: 'acme' },
    { cwd },
  );
  assert.equal(result.tenantId, 'acme');
  assert.equal(result.mode, 'enterprise');
});

test('validateTenantAtStartup resolves to "local" for solo mode with no tenant configured', () => {
  const cwd = project();
  const result = validateTenantAtStartup({}, { cwd });
  assert.equal(result.tenantId, DEFAULT_TENANT_ID);
  assert.equal(result.mode, 'solo');
});

test('createIntakeQueue stamps tenantId "local" by default (solo)', () => {
  const cwd = project();
  const queue = createIntakeQueue(cwd, {});
  assert.equal(queue.tenantId, DEFAULT_TENANT_ID);
});

test('createIntakeQueue reads CONSTRUCT_TENANT_ID from env', () => {
  const cwd = project();
  const queue = createIntakeQueue(cwd, { [TENANT_ID_ENV_KEY]: 'tenant-x' });
  assert.equal(queue.tenantId, 'tenant-x');
});

test('createIntakeQueue honors an explicit opts.tenantId override', () => {
  const cwd = project();
  const queue = createIntakeQueue(cwd, { [TENANT_ID_ENV_KEY]: 'tenant-x' }, { tenantId: 'explicit-override' });
  assert.equal(queue.tenantId, 'explicit-override');
});

test('planRun stamps tenantId "local" on the run and every task in solo mode', async () => {
  const cwd = project();
  const run = await planRun(
    { request: 'Refactor the auth module and add a migration; review for security', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: BASE_ENV, cwd },
  );
  assert.equal(run.tenantId, DEFAULT_TENANT_ID);
  assert.ok(run.tasks.length > 0, 'run has tasks to check');
  assert.ok(run.tasks.every((t) => t.tenantId === DEFAULT_TENANT_ID));
});

test('planRun propagates an explicit tenant id from env through run and tasks', async () => {
  const cwd = project();
  const env = { ...BASE_ENV, [TENANT_ID_ENV_KEY]: 'tenant-acme' };
  const run = await planRun(
    { request: 'Refactor the auth module and add a migration; review for security', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env, cwd },
  );
  assert.equal(run.tenantId, 'tenant-acme');
  assert.ok(run.tasks.every((t) => t.tenantId === 'tenant-acme'));

  const completed = await executeRun(cwd, run.runId, { env });
  assert.equal(completed.tenantId, 'tenant-acme');
  assert.ok(completed.tasks.every((t) => t.tenantId === 'tenant-acme'));
});

test('planRun fails closed for enterprise mode with no resolvable tenant', async () => {
  const cwd = project();
  const env = { ...BASE_ENV, CONSTRUCT_DEPLOYMENT_MODE: 'enterprise' };
  await assert.rejects(
    planRun({ request: 'design a system', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 3 }, { env, cwd }),
    (err) => {
      assert.ok(err instanceof TenantResolutionError);
      assert.match(err.message, /enterprise mode requires a resolvable tenant id/);
      return true;
    },
  );
});

test('planRun succeeds for enterprise mode with a resolvable tenant and stamps it', async () => {
  const cwd = project();
  const env = { ...BASE_ENV, CONSTRUCT_DEPLOYMENT_MODE: 'enterprise', [TENANT_ID_ENV_KEY]: 'enterprise-tenant' };
  const run = await planRun({ request: 'design a system', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 3 }, { env, cwd });
  assert.equal(run.tenantId, 'enterprise-tenant');
  assert.ok(run.tasks.every((t) => t.tenantId === 'enterprise-tenant'));
});
