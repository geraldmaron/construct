/**
 * tests/migrations-runner.test.mjs — unit tests for the postgres migration runner.
 *
 * Uses an in-memory mock of the `postgres` template-literal client so the
 * tests do not require a real database. The mock records DDL strings and
 * tracks rows in a fake `construct_schema_migrations` table; that's enough
 * to verify ordering, idempotency, and drift detection without booting Docker.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before, after } from 'node:test';
import { runMigrations, describeMigrations } from '../lib/storage/migrations.mjs';

let tmpDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-migrations-'));
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeMigration(dir, name, sql) {
  fs.writeFileSync(path.join(dir, name), sql);
}

function makeMockClient() {
  const applied = new Map();
  const ddlLog = [];

  function templateClient(strings, ...values) {
    const text = strings.reduce(
      (acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''),
      ''
    );

    const insertMatch = /INSERT INTO construct_schema_migrations/i.test(text);
    const selectAllMatch = /SELECT filename, sha FROM construct_schema_migrations/i.test(text);
    const selectLatestMatch = /ORDER BY applied_at DESC/i.test(text);
    const countMatch = /SELECT count\(\*\)/i.test(text);

    if (insertMatch) {
      const filename = values[0];
      const sha = values[1];
      applied.set(filename, { sha, applied_at: new Date().toISOString() });
      return Promise.resolve([]);
    }
    if (selectAllMatch) {
      return Promise.resolve(
        [...applied.entries()].map(([filename, row]) => ({ filename, sha: row.sha }))
      );
    }
    if (selectLatestMatch) {
      const sorted = [...applied.entries()].sort((a, b) => (a[1].applied_at < b[1].applied_at ? 1 : -1));
      return Promise.resolve(sorted.slice(0, 1).map(([filename, row]) => ({
        filename, sha: row.sha, applied_at: row.applied_at,
      })));
    }
    if (countMatch) {
      return Promise.resolve([{ n: applied.size }]);
    }

    return Promise.resolve([]);
  }

  templateClient.unsafe = async (ddl) => {
    ddlLog.push(ddl);
  };

  templateClient.begin = async (cb) => {
    return cb(templateClient);
  };

  return { client: templateClient, ddlLog, applied };
}

describe('runMigrations', () => {
  it('applies all pending migrations in lexical order', async () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, 'apply-'));
    writeMigration(dir, '001_a.sql', 'SELECT 1;');
    writeMigration(dir, '002_b.sql', 'SELECT 2;');
    writeMigration(dir, '003_c.sql', 'SELECT 3;');
    const { client, ddlLog } = makeMockClient();

    const result = await runMigrations(client, { dir });
    assert.deepEqual(result.applied, ['001_a.sql', '002_b.sql', '003_c.sql']);
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(result.drift, []);
    const appliedDdl = ddlLog.filter((s) => s.includes('SELECT'));
    assert.deepEqual(appliedDdl, ['SELECT 1;', 'SELECT 2;', 'SELECT 3;']);
  });

  it('is a no-op when run twice against an unchanged tree', async () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, 'noop-'));
    writeMigration(dir, '001_a.sql', 'SELECT 1;');
    writeMigration(dir, '002_b.sql', 'SELECT 2;');
    const { client } = makeMockClient();

    await runMigrations(client, { dir });
    const second = await runMigrations(client, { dir });
    assert.deepEqual(second.applied, []);
    assert.deepEqual(second.skipped, ['001_a.sql', '002_b.sql']);
  });

  it('throws on drift when a previously-applied migration file changes', async () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, 'drift-'));
    writeMigration(dir, '001_a.sql', 'SELECT 1;');
    const { client } = makeMockClient();

    await runMigrations(client, { dir });

    writeMigration(dir, '001_a.sql', 'SELECT 2;');

    await assert.rejects(
      () => runMigrations(client, { dir }),
      /Migration drift detected/
    );
  });

  it('describeMigrations reports applied count and detects drift without throwing', async () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, 'describe-'));
    writeMigration(dir, '001_a.sql', 'SELECT 1;');
    writeMigration(dir, '002_b.sql', 'SELECT 2;');
    const { client } = makeMockClient();

    await runMigrations(client, { dir });

    const before = await describeMigrations(client, { dir });
    assert.equal(before.ok, true);
    assert.equal(before.appliedCount, 2);
    assert.equal(before.drift.length, 0);

    writeMigration(dir, '001_a.sql', 'SELECT changed;');
    const after = await describeMigrations(client, { dir });
    assert.equal(after.ok, true);
    assert.equal(after.drift.length, 1);
    assert.equal(after.drift[0], '001_a.sql');
  });
});
