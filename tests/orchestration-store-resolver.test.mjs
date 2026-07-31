/**
 * tests/orchestration-store-resolver.test.mjs — run-store resolver selection.
 *
 * Pins the resolver's selection and fallback policy: filesystem is the default
 * for solo deployments, the CONSTRUCT_ORCHESTRATION_STORE env override and the
 * orchestration.store config select a backend, and an unavailable backend (sqlite
 * on Node <22.5, postgres with no DATABASE_URL) falls back to filesystem with a
 * recorded warning rather than failing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveRunStore } from '../lib/orchestration/store.mjs';
import { sqliteAvailable } from '../lib/orchestration/run-store-sqlite.mjs';

const dirs = [];
function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-orch-resolver-'));
  dirs.push(cwd);
  return cwd;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

// resolveRunStore's sqlite branch resolves its db directory through the
// machine-scoped state root, which reads CONSTRUCT_HOME_OVERRIDE from
// real process.env directly. Pin it for the whole file so a sqlite-backend
// resolution never writes into the real developer machine's
// ~/.construct/projects/.

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-orch-resolver-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

test('defaults to filesystem for a solo deployment', () => {
  const { backend, warnings } = resolveRunStore({ config: {}, env: { CONSTRUCT_DEPLOYMENT_MODE: 'solo' }, cwd: project() });
  assert.equal(backend, 'filesystem');
  assert.deepEqual(warnings, []);
});

test('env override selects the backend', () => {
  const { backend } = resolveRunStore({ config: {}, env: { CONSTRUCT_ORCHESTRATION_STORE: 'filesystem' }, cwd: project() });
  assert.equal(backend, 'filesystem');
});

test('config orchestration.store selects sqlite when available, else falls back', () => {
  const { backend, warnings } = resolveRunStore({ config: { orchestration: { store: 'sqlite' } }, env: {}, cwd: project() });
  if (sqliteAvailable()) {
    assert.equal(backend, 'sqlite');
    assert.deepEqual(warnings, []);
  } else {
    assert.equal(backend, 'filesystem');
    assert.ok(warnings.some((w) => /sqlite/i.test(w)));
  }
});

test('postgres without DATABASE_URL falls back to filesystem with a warning', () => {
  const env = { CONSTRUCT_ORCHESTRATION_STORE: 'postgres', DATABASE_URL: '', CONSTRUCT_DATABASE_URL: '' };
  const { backend, requestedBackend, degraded, degradedReason, warnings } = resolveRunStore({ config: {}, env, cwd: project() });
  assert.equal(backend, 'filesystem');
  assert.equal(requestedBackend, 'postgres');
  assert.equal(degraded, true);
  assert.equal(degradedReason, 'postgres-unavailable');
  assert.ok(warnings.some((w) => /postgres/i.test(w)));
});

test('team deployment without DATABASE_URL falls back to filesystem', () => {
  const env = { CONSTRUCT_DEPLOYMENT_MODE: 'team', DATABASE_URL: '', CONSTRUCT_DATABASE_URL: '' };
  const { backend, requestedBackend, degraded, degradedReason, warnings } = resolveRunStore({ config: {}, env, cwd: project() });
  assert.equal(backend, 'filesystem');
  assert.equal(requestedBackend, 'postgres');
  assert.equal(degraded, true);
  assert.equal(degradedReason, 'postgres-unavailable');
  assert.ok(warnings.some((w) => /postgres/i.test(w)));
});

test('project storage manifest can select a fixture run-store backend', () => {
  const cwd = project();
  fs.mkdirSync(path.join(cwd, '.construct', 'providers'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.construct', 'providers', 'fixture-store.manifest.json'), `${JSON.stringify({
    id: 'fixture-store',
    version: '1.0.0',
    kind: 'storage',
    capabilities: ['orchestration-run-store'],
    operations: { runStore: 'filesystem' },
    healthCheck: { kind: 'in-process', description: 'Filesystem-backed fixture store for resolver tests.' },
    owner: 'construct-core',
    compatVersion: 1,
  }, null, 2)}\n`);

  const { backend, provider, warnings } = resolveRunStore({
    config: { orchestration: { store: 'fixture-store' } },
    env: {},
    cwd,
  });

  assert.equal(backend, 'fixture-store');
  assert.equal(provider.id, 'fixture-store');
  assert.deepEqual(warnings, []);
});

test('unregistered explicit storage backend degrades visibly instead of falling through', () => {
  const { backend, requestedBackend, degraded, degradedReason, warnings } = resolveRunStore({
    config: { orchestration: { store: 'missing-store' } },
    env: {},
    cwd: project(),
  });

  assert.equal(backend, 'filesystem');
  assert.equal(requestedBackend, 'missing-store');
  assert.equal(degraded, true);
  assert.equal(degradedReason, 'storage-backend-unregistered');
  assert.ok(warnings.some((w) => /missing-store/.test(w)));
});

test('the resolved filesystem store round-trips a run', async () => {
  const { store } = resolveRunStore({ config: {}, env: { CONSTRUCT_DEPLOYMENT_MODE: 'solo' }, cwd: project() });
  const run = { runId: 'run-resolver-1', createdAt: new Date().toISOString(), status: 'planned', execution: { executionMode: 'construct-orchestrated' }, request: { summary: 's' }, tasks: [] };
  await store.saveRun(run);
  const loaded = await store.loadRun('run-resolver-1');
  assert.equal(loaded.runId, 'run-resolver-1');
  const list = await store.listRuns({ limit: 5 });
  assert.ok(list.some((r) => r.runId === 'run-resolver-1'));
});
