/**
 * tests/functional/sql-client.functional.test.mjs — G1 SQL client contract.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createSqlClient, closeSqlClient, probeSqlClient } from '../../lib/storage/backend.mjs';
import { applyMigrations, getMigrationStatus } from '../../lib/db/migrate.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REQUIRE_LIVE = process.env.CONSTRUCT_REQUIRE_POSTGRES_TEST === '1';
const LIVE_ENV = {
  DATABASE_URL: process.env.DATABASE_URL || process.env.CONSTRUCT_DATABASE_URL || '',
};

test('solo/no-url mode never opens a SQL client', () => {
  let loaded = false;
  const sql = createSqlClient({ CONSTRUCT_DEPLOYMENT_MODE: 'solo' }, {
    postgresFactory: () => { loaded = true; },
  });
  assert.equal(sql, null);
  assert.equal(loaded, false);
});

test('construct db status reports unavailable without database configuration', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-sql-cli-'));
  t.after(() => rmTmpDir(home));
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    CONSTRUCT_HOME_OVERRIDE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    CONSTRUCT_ASCII: '1',
  };
  const result = spawnSync(process.execPath, ['./bin/construct', 'db', 'status', '--json'], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'unavailable');
  assert.equal(payload.reason, 'sql-client-unavailable');
});

test('live Postgres client probes and migrations apply idempotently when required', async (t) => {
  const sql = createSqlClient({ ...process.env, ...LIVE_ENV });
  if (!sql && !REQUIRE_LIVE) {
    t.skip('DATABASE_URL/CONSTRUCT_DATABASE_URL and optional postgres dependency are required for live SQL test');
    return;
  }
  assert.ok(sql, 'CONSTRUCT_REQUIRE_POSTGRES_TEST=1 requires a configured Postgres SQL client');

  try {
    const probe = await probeSqlClient(sql);
    assert.equal(probe.status, 'available');
    const first = await applyMigrations(sql);
    const second = await applyMigrations(sql);
    const status = await getMigrationStatus(sql);
    assert.ok(status.some((m) => m.id === '001_orchestration_runs' && m.applied));
    assert.deepEqual(second.applied, []);
    assert.ok(Array.isArray(first.applied));
  } finally {
    await closeSqlClient(sql);
  }
});
