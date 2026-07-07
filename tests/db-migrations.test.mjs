/**
 * tests/db-migrations.test.mjs — Postgres migration runner.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyMigrations, getMigrationStatus, listMigrationFiles } from '../lib/db/migrate.mjs';

function tmpdir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-db-migrations-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fakeSql() {
  const state = { applied: new Set(), unsafe: [] };
  function query(strings, ...values) {
    const text = Array.isArray(strings) ? strings.join('?') : String(strings);
    if (/SELECT id, applied_at FROM construct_schema_migrations/i.test(text)) {
      return Promise.resolve([...state.applied].sort().map((id) => ({ id, applied_at: new Date(0).toISOString() })));
    }
    if (/INSERT INTO construct_schema_migrations/i.test(text)) {
      state.applied.add(values[0]);
    }
    return Promise.resolve([]);
  }
  query.unsafe = async (body) => { state.unsafe.push(body); };
  query.begin = async (fn) => fn(query);
  query.state = state;
  return query;
}

test('listMigrationFiles returns ordered SQL migrations only', (t) => {
  const dir = tmpdir(t);
  fs.writeFileSync(path.join(dir, '002_second.sql'), 'SELECT 2;');
  fs.writeFileSync(path.join(dir, '001_first.sql'), 'SELECT 1;');
  fs.writeFileSync(path.join(dir, 'README.md'), 'ignore');

  assert.deepEqual(
    listMigrationFiles({ migrationsDir: dir }).map((file) => path.basename(file)),
    ['001_first.sql', '002_second.sql'],
  );
});

test('applyMigrations is idempotent and records applied migrations', async (t) => {
  const dir = tmpdir(t);
  fs.writeFileSync(path.join(dir, '001_first.sql'), 'CREATE TABLE one(id text);');
  fs.writeFileSync(path.join(dir, '002_second.sql'), 'CREATE TABLE two(id text);');
  const sql = fakeSql();

  const first = await applyMigrations(sql, { migrationsDir: dir });
  const second = await applyMigrations(sql, { migrationsDir: dir });
  const status = await getMigrationStatus(sql, { migrationsDir: dir });

  assert.deepEqual(first.applied, ['001_first', '002_second']);
  assert.deepEqual(second.applied, []);
  assert.equal(sql.state.unsafe.length, 2);
  assert.deepEqual(status.map((m) => [m.id, m.applied]), [
    ['001_first', true],
    ['002_second', true],
  ]);
});
