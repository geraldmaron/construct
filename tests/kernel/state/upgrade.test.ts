/** Complete format-5 stores upgrade explicitly; every other unsupported store stays untouched. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sterile, type SterileFixture } from '../../harness/sterile.ts';
import { openStateStore } from '../../../src/kernel/state/open.ts';
import { UnsupportedStateError } from '../../../src/kernel/state/format.ts';
import { REQUIRED_TABLES } from '../../../src/kernel/state/schema.ts';

function storeFrom(fx: SterileFixture): string {
  const path = join(fx.root, 'construct.sqlite');
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(readFileSync(new URL('./fixtures/format-5.sql', import.meta.url), 'utf8'));
  db.close();
  return path;
}

function freshPath(fx: SterileFixture): string {
  const dbPath = join(fx.root, 'fresh', 'construct.sqlite');
  openStateStore(dbPath).close();
  return dbPath;
}

function normalize(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

/** A CREATE TABLE's column and table-constraint definitions, split at top-level commas. */
function definitions(sql: string): string[] {
  const body = normalize(sql)
    .replace(/^[^(]*\(/, '')
    .replace(/\)$/, '');
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
    } else current += ch;
  }
  out.push(current.trim());
  return out;
}

interface Schema {
  readonly tables: Map<string, string[]>;
  /** Indexes and triggers, by name, with whitespace normalized. */
  readonly others: Map<string, string>;
}

function schemaOf(dbPath: string): Schema {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare(`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all() as Array<{ type: string; name: string; sql: string }>;
    return {
      tables: new Map(rows.filter((r) => r.type === 'table').map((r) => [r.name, definitions(r.sql)])),
      others: new Map(rows.filter((r) => r.type !== 'table').map((r) => [`${r.type}:${r.name}`, normalize(r.sql)])),
    };
  } finally {
    db.close();
  }
}

/** Per table, the definitions only one side has; and the tables whose columns sit in a different order. */
function compare(
  upgraded: Schema,
  fresh: Schema,
): { differ: Record<string, { fresh: string[]; upgraded: string[] }>; reordered: string[] } {
  assert.deepEqual([...upgraded.tables.keys()], [...fresh.tables.keys()], 'the same tables');
  assert.deepEqual(upgraded.others, fresh.others, 'the same indexes and triggers');
  const differ: Record<string, { fresh: string[]; upgraded: string[] }> = {};
  const reordered: string[] = [];
  for (const [table, freshDefs] of fresh.tables) {
    const upDefs = upgraded.tables.get(table)!;
    const onlyFresh = freshDefs.filter((d) => !upDefs.includes(d));
    const onlyUp = upDefs.filter((d) => !freshDefs.includes(d));
    if (onlyFresh.length || onlyUp.length) differ[table] = { fresh: onlyFresh, upgraded: onlyUp };
    const names = (defs: string[]): string => defs.map((d) => d.split(' ')[0]).join(' ');
    if (names(upDefs) !== names(freshDefs)) reordered.push(table);
  }
  return { differ, reordered };
}

test('a complete format-5 store upgrades to the fresh schema and keeps every work item', () => {
  const fx = sterile();
  try {
    const path = storeFrom(fx);
    const before = new DatabaseSync(path, { readOnly: true });
    const work = before.prepare('SELECT * FROM work_items ORDER BY id').all();
    before.close();
    let backups = 0;
    const store = openStateStore(path, {
      migrate: true,
      beforeUpgrade: (version) => {
        assert.equal(version, 5);
        const db = new DatabaseSync(path, { readOnly: true });
        try {
          assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'format_version'").get()?.value, '5');
          assert.equal(db.prepare('SELECT COUNT(*) AS n FROM work_legacy_ids').get()?.n, 1);
        } finally {
          db.close();
        }
        backups += 1;
      },
    });
    assert.equal(backups, 1);
    assert.equal(store.migratedFrom, 5);
    assert.equal(store.db.prepare("SELECT value FROM meta WHERE key = 'format_version'").get()?.value, '6');
    assert.deepEqual(store.db.prepare('SELECT * FROM work_items ORDER BY id').all(), work);
    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('work_legacy_ids', 'work_legacy_work')").get()?.n,
      0,
    );
    store.close();
    assert.deepEqual(compare(schemaOf(path), schemaOf(freshPath(fx))), { differ: {}, reordered: [] });
  } finally {
    fx.cleanup();
  }
});

test('format 5 without a writable migrate request is refused as older without writes', () => {
  const fx = sterile();
  try {
    const path = storeFrom(fx);
    const bytes = readFileSync(path);
    for (const options of [{}, { readOnly: true }, { readOnly: true, migrate: true }]) {
      assert.throws(
        () => openStateStore(path, options),
        (error: unknown) => error instanceof UnsupportedStateError && error.kind === 'older',
      );
      assert.deepEqual(readFileSync(path), bytes);
    }
  } finally {
    fx.cleanup();
  }
});

for (const table of [...REQUIRED_TABLES, 'work_legacy_ids'].filter((name) => name !== 'meta')) {
  test(`format 5 without ${table} is refused unread before backup`, () => {
    const fx = sterile();
    try {
      const path = storeFrom(fx);
      const db = new DatabaseSync(path);
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec(`DROP TABLE ${table}`);
      db.close();
      const bytes = readFileSync(path);
      let backups = 0;
      for (const options of [
        {},
        { readOnly: true },
        {
          migrate: true,
          beforeUpgrade: () => {
            backups += 1;
          },
        },
      ])
        assert.throws(
          () => openStateStore(path, options),
          (error: unknown) => error instanceof UnsupportedStateError && error.kind === 'foreign',
        );
      assert.equal(backups, 0);
      assert.deepEqual(readFileSync(path), bytes);
    } finally {
      fx.cleanup();
    }
  });
}

for (const version of [2, 3, 4, 7]) {
  test(`format ${version} is refused unchanged with the correct kind`, () => {
    const fx = sterile();
    try {
      const path = storeFrom(fx);
      const db = new DatabaseSync(path);
      db.prepare("UPDATE meta SET value = ? WHERE key = 'format_version'").run(String(version));
      db.close();
      const bytes = readFileSync(path);
      let backups = 0;
      for (const options of [
        {},
        { readOnly: true },
        {
          migrate: true,
          beforeUpgrade: () => {
            backups += 1;
          },
        },
      ])
        assert.throws(
          () => openStateStore(path, options),
          (error: unknown) =>
            error instanceof UnsupportedStateError &&
            error.kind === (version === 7 ? 'newer' : 'foreign') &&
            error.foundVersion === version,
        );
      assert.equal(backups, 0);
      assert.deepEqual(readFileSync(path), bytes);
    } finally {
      fx.cleanup();
    }
  });
}

test('a backup failure leaves format 5 and all rows untouched', () => {
  const fx = sterile();
  try {
    const path = storeFrom(fx);
    const bytes = readFileSync(path);
    assert.throws(
      () =>
        openStateStore(path, {
          migrate: true,
          beforeUpgrade: () => {
            throw new Error('backup failed');
          },
        }),
      /backup failed/,
    );
    assert.deepEqual(readFileSync(path), bytes);
  } finally {
    fx.cleanup();
  }
});

test('a store that turns newer while the upgrade waits for the lock is refused as newer, not reported upgraded', async () => {
  const fx = sterile();
  try {
    const dbPath = storeFrom(fx);
    const wal = new DatabaseSync(dbPath);
    wal.exec('PRAGMA journal_mode = WAL');
    wal.close();
    // Another build takes the write lock, and commits format 7 a moment after this one starts waiting.
    const newer = spawn(process.execPath, [
      '-e',
      `
      const { DatabaseSync } = require('node:sqlite');
      const d = new DatabaseSync(${JSON.stringify(dbPath)});
      d.exec('BEGIN IMMEDIATE');
      d.prepare("UPDATE meta SET value = '7' WHERE key = 'format_version'").run();
      process.stdout.write('locked\\n');
      setTimeout(() => { d.exec('COMMIT'); d.close(); }, 400);
    `,
    ]);
    await new Promise<void>((resolve) => newer.stdout.once('data', () => resolve()));
    let backups = 0;
    assert.throws(
      () => openStateStore(dbPath, { migrate: true, beforeUpgrade: () => (backups += 1) }),
      (err: unknown) => err instanceof UnsupportedStateError && err.kind === 'newer' && err.foundVersion === 7,
    );
    assert.equal(backups, 0);
    await new Promise<void>((resolve) => (newer.exitCode !== null ? resolve() : newer.once('exit', () => resolve())));
    const after = new DatabaseSync(dbPath, { readOnly: true });
    assert.equal((after.prepare(`SELECT value FROM meta WHERE key = 'format_version'`).get() as { value: string }).value, '7');
    assert.equal(
      (after.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'work_legacy_ids'`).get() as { n: number }).n,
      1,
      'the migration did not drop the mapping table',
    );
    after.close();
  } finally {
    fx.cleanup();
  }
});
