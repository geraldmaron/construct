/**
 * tests/storage-backend.test.mjs — optional Postgres SQL client resolver.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSqlClient, closeSqlClient, probeSqlClient } from '../lib/storage/backend.mjs';

test('createSqlClient returns null with no configured database URL', () => {
  let loaded = false;
  const client = createSqlClient({}, { postgresFactory: () => { loaded = true; } });
  assert.equal(client, null);
  assert.equal(loaded, false);
});

test('createSqlClient accepts DATABASE_URL and configures Postgres.js options', () => {
  const calls = [];
  const fakeFactory = (url, options) => {
    calls.push({ url, options });
    return { end: async () => {} };
  };

  const client = createSqlClient({
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/construct',
    CONSTRUCT_DB_MAX_CONNECTIONS: '7',
    CONSTRUCT_DB_IDLE_TIMEOUT_SECONDS: '11',
    CONSTRUCT_DB_CONNECT_TIMEOUT_SECONDS: '13',
    CONSTRUCT_DB_SSL: 'require',
    CONSTRUCT_DB_APPLICATION_NAME: 'construct-test',
  }, { postgresFactory: fakeFactory });

  assert.ok(client);
  assert.equal(calls[0].url, 'postgresql://user:pass@localhost:5432/construct');
  assert.equal(calls[0].options.max, 7);
  assert.equal(calls[0].options.idle_timeout, 11);
  assert.equal(calls[0].options.connect_timeout, 13);
  assert.equal(calls[0].options.ssl, 'require');
  assert.equal(calls[0].options.connection.application_name, 'construct-test');
});

test('createSqlClient accepts CONSTRUCT_DATABASE_URL alias', () => {
  const calls = [];
  createSqlClient({
    CONSTRUCT_DATABASE_URL: 'postgresql://user:pass@localhost:5432/construct',
  }, { postgresFactory: (url, options) => {
    calls.push({ url, options });
    return { end: async () => {} };
  } });

  assert.equal(calls[0].url, 'postgresql://user:pass@localhost:5432/construct');
});

test('probeSqlClient reports availability and closeSqlClient delegates to end', async () => {
  const seen = [];
  let ended = false;
  const sql = Object.assign((strings) => {
    seen.push(strings.join(''));
    return Promise.resolve([{ ok: 1 }]);
  }, {
    end: async (opts) => { ended = opts.timeout === 5; },
  });

  const probe = await probeSqlClient(sql);
  await closeSqlClient(sql);

  assert.equal(probe.status, 'available');
  assert.match(seen[0], /SELECT 1 AS ok/);
  assert.equal(ended, true);
});
