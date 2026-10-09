/**
 * tests/kernel/state/upgrade.test.ts — stores built from the frozen format-2
 * and format-3 schemas upgrade to what a fresh store holds, less exactly the
 * differences SQLite cannot remove. No claim token issued before the upgrade
 * settles anything after it. An incomplete store, or one that turns newer
 * while the upgrade waits for the lock, is refused and left as it was.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sterile, type SterileFixture } from '../../harness/sterile.ts';
import { openStateStore } from '../../../src/kernel/state/open.ts';
import { UnsupportedStateError } from '../../../src/kernel/state/format.ts';
import { completeWork, getWork, releaseWork } from '../../../src/kernel/work/service.ts';

type Fixture = 'format-4' | 'format-2' | 'format-3' | 'format-3-upgraded-from-2';

/** A store exactly as an older build left it: its frozen schema, stamped with its format. */
function storeFrom(fx: SterileFixture, fixture: Fixture, version: number): string {
  const dbPath = join(fx.root, '.construct', 'state', 'construct.sqlite');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(readFileSync(new URL(`./fixtures/${fixture}.sql`, import.meta.url), 'utf8'));
  db.prepare(`INSERT INTO meta (key, value) VALUES ('format', 'construct-state'), ('format_version', ?)`).run(String(version));
  db.close();
  return dbPath;
}

function freshPath(fx: SterileFixture): string {
  const dbPath = join(fx.root, 'fresh', 'construct.sqlite');
  openStateStore(dbPath).close();
  return dbPath;
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
}

/** A CREATE TABLE's column and table-constraint definitions, split at top-level commas. */
function definitions(sql: string): string[] {
  const body = normalize(sql).replace(/^[^(]*\(/, '').replace(/\)$/, '');
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
    const rows = db.prepare(`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ type: string; name: string; sql: string }>;
    return {
      tables: new Map(rows.filter((r) => r.type === 'table').map((r) => [r.name, definitions(r.sql)])),
      others: new Map(rows.filter((r) => r.type !== 'table').map((r) => [`${r.type}:${r.name}`, normalize(r.sql)])),
    };
  } finally {
    db.close();
  }
}

/** Per table, the definitions only one side has; and the tables whose columns sit in a different order. */
function compare(upgraded: Schema, fresh: Schema): { differ: Record<string, { fresh: string[]; upgraded: string[] }>; reordered: string[] } {
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

test('a fresh format-3 store upgrades to exactly what a fresh format-5 store holds', () => {
  const fx = sterile();
  try {
    const old = storeFrom(fx, 'format-3', 3);
    const upgraded = openStateStore(old, { migrate: true });
    assert.equal(upgraded.migratedFrom, 3);
    upgraded.close();
    assert.deepEqual(compare(schemaOf(old), schemaOf(freshPath(fx))), { differ: {}, reordered: [] });
  } finally {
    fx.cleanup();
  }
});

test('a format-2 store upgrades with every column, constraint, index, and trigger a fresh store has; only where appended columns sit differs', () => {
  const fx = sterile();
  try {
    const old = storeFrom(fx, 'format-2', 2);
    const upgraded = openStateStore(old, { migrate: true });
    assert.equal(upgraded.migratedFrom, 2);
    upgraded.close();
    assert.deepEqual(compare(schemaOf(old), schemaOf(freshPath(fx))), {
      differ: {},
      reordered: ['claims', 'source_snapshots', 'statements'],
    });
  } finally {
    fx.cleanup();
  }
});

test('a format-3 store whose two flag columns carry no CHECK keeps exactly that difference, since SQLite cannot add one to an existing column', () => {
  const fx = sterile();
  try {
    const old = storeFrom(fx, 'format-3-upgraded-from-2', 3);
    openStateStore(old, { migrate: true }).close();
    assert.deepEqual(compare(schemaOf(old), schemaOf(freshPath(fx))), {
      differ: {
        statements: { fresh: ['quoted INTEGER NOT NULL DEFAULT 0 CHECK (quoted IN (0, 1))'], upgraded: ['quoted INTEGER NOT NULL DEFAULT 0'] },
        workflow_runs: { fresh: ['cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1))'], upgraded: ['cancel_requested INTEGER NOT NULL DEFAULT 0'] },
      },
      reordered: ['claims', 'source_snapshots', 'statements'],
    });
  } finally {
    fx.cleanup();
  }
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('a claim held across the upgrade stays held, and the format-3 token anyone could rebuild from a read settles nothing', () => {
  const fx = sterile();
  try {
    const dbPath = storeFrom(fx, 'format-3', 3);
    const created = '2026-09-01T10:00:00.000Z';
    const claimedAt = '2026-09-01T10:05:00.000Z';
    const until = '2026-09-01T11:00:00.000Z';
    // The format-3 build minted `${owner}:${now}:${revision}` and wrote now and revision onto the row.
    const formatThreeToken = `person via cli:${claimedAt}:2`;
    const db = new DatabaseSync(dbPath);
    const insert = db.prepare(
      `INSERT INTO work_items (id, kind, title, description, status, revision, claim_owner, claim_token, claim_until, created_at, updated_at)
       VALUES (?, 'task', ?, 'from before the upgrade', ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run('w-held', 'held', 'claimed', 2, 'person via cli', formatThreeToken, until, created, claimedAt);
    insert.run('w-open', 'open', 'open', 1, null, null, null, created, created);
    db.close();

    const store = openStateStore(dbPath, { migrate: true });
    try {
      const held = store.db.prepare(`SELECT status, claim_owner, claim_token, claim_until FROM work_items WHERE id = 'w-held'`).get() as { status: string; claim_owner: string; claim_token: string; claim_until: string };
      assert.equal(held.status, 'claimed');
      assert.equal(held.claim_owner, 'person via cli');
      assert.equal(held.claim_until, until);
      assert.match(held.claim_token, UUID);
      const open = store.db.prepare(`SELECT claim_token FROM work_items WHERE id = 'w-open'`).get() as { claim_token: string | null };
      assert.equal(open.claim_token, null);

      const shown = getWork(store, 'w-held')!;
      const rebuilt = `${shown.claimOwner!}:${shown.updatedAt}:${String(shown.revision)}`;
      assert.equal(rebuilt, formatThreeToken, 'the old token is exactly what a read shows');
      const during = '2026-09-01T10:30:00.000Z';
      assert.throws(() => completeWork(store, { id: 'w-held', owner: 'person via cli', token: rebuilt, at: during }), /held by person via cli/);
      assert.throws(() => releaseWork(store, { id: 'w-held', owner: 'person via cli', token: rebuilt, at: during }), /not held under that token/);
      assert.equal(getWork(store, 'w-held')!.status, 'claimed');
      // Once the claim expires it protects nothing, so the item is not stranded.
      assert.equal(completeWork(store, { id: 'w-held', owner: 'someone else', at: '2026-09-01T12:00:00.000Z' }).status, 'completed');
    } finally {
      store.close();
    }
  } finally {
    fx.cleanup();
  }
});

test('a format-3 store missing a format-3 table is refused unread, and nothing about the file changes', () => {
  const fx = sterile();
  try {
    const dbPath = storeFrom(fx, 'format-3', 3);
    const db = new DatabaseSync(dbPath);
    db.exec('DROP TABLE run_bindings');
    db.close();
    const before = readFileSync(dbPath);
    let backups = 0;
    for (const options of [{ readOnly: true }, {}, { migrate: true, beforeUpgrade: () => (backups += 1) }]) {
      assert.throws(() => openStateStore(dbPath, options), (err: unknown) => err instanceof UnsupportedStateError && err.kind === 'foreign' && err.foundVersion === 3);
    }
    assert.equal(backups, 0, 'no backup is asked for');
    assert.ok(readFileSync(dbPath).equals(before), 'the file is byte for byte as it was');
  } finally {
    fx.cleanup();
  }
});

test('a store that turns newer while the upgrade waits for the lock is refused as newer, not reported upgraded', async () => {
  const fx = sterile();
  try {
    const dbPath = storeFrom(fx, 'format-3', 3);
    const wal = new DatabaseSync(dbPath);
    wal.exec('PRAGMA journal_mode = WAL');
    wal.close();
    // Another build takes the write lock, and commits format 99 a moment after this one starts waiting.
    const newer = spawn(process.execPath, ['-e', `
      const { DatabaseSync } = require('node:sqlite');
      const d = new DatabaseSync(${JSON.stringify(dbPath)});
      d.exec('BEGIN IMMEDIATE');
      d.prepare("UPDATE meta SET value = '99' WHERE key = 'format_version'").run();
      process.stdout.write('locked\\n');
      setTimeout(() => { d.exec('COMMIT'); d.close(); }, 400);
    `]);
    await new Promise<void>((resolve) => newer.stdout.once('data', () => resolve()));
    let backups = 0;
    assert.throws(
      () => openStateStore(dbPath, { migrate: true, beforeUpgrade: () => (backups += 1) }),
      (err: unknown) => err instanceof UnsupportedStateError && err.kind === 'newer' && err.foundVersion === 99,
    );
    assert.equal(backups, 0);
    await new Promise<void>((resolve) => (newer.exitCode !== null ? resolve() : newer.once('exit', () => resolve())));
    const after = new DatabaseSync(dbPath, { readOnly: true });
    assert.equal((after.prepare(`SELECT value FROM meta WHERE key = 'format_version'`).get() as { value: string }).value, '99');
    assert.equal((after.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'sessions'`).get() as { n: number }).n, 0, 'nothing of format 4 was written');
    after.close();
  } finally {
    fx.cleanup();
  }
});


test('format 4 migration preserves firing history and permits the same key in independent triggers', () => {
  const fx = sterile();
  try {
    const path = storeFrom(fx, 'format-4', 4);
    const db = new DatabaseSync(path);
    for (const id of ['east', 'west']) db.prepare(`INSERT INTO triggers (id, workflow_id, kind, event_name, adapter, enabled, overlap, max_tier, delivery_json, input_json, created_at, updated_at) VALUES (?, 'sweep', 'event', 'tick', 'cron', 1, 'skip', 'observe', '{}', '{}', '2026-10-09T00:00:00Z', '2026-10-09T00:00:00Z')`).run(id);
    db.exec(`INSERT INTO trigger_firings VALUES ('old', 'east', '09:00', '2026-10-09T09:00:00Z', NULL, 'disabled', 'retained audit')`);
    db.close();
    assert.throws(() => openStateStore(path), UnsupportedStateError);
    const store = openStateStore(path, { migrate: true });
    assert.equal(store.migratedFrom, 4);
    assert.equal((store.db.prepare("SELECT reason FROM trigger_firings WHERE id = 'old'").get() as {reason:string}).reason, 'retained audit');
    store.db.exec(`INSERT INTO trigger_firings VALUES ('new', 'west', '09:00', '2026-10-09T09:00:00Z', NULL, 'disabled', 'separate intent')`);
    assert.throws(() => store.db.exec(`INSERT INTO trigger_firings VALUES ('dup', 'east', '09:00', '2026-10-09T09:00:00Z', NULL, 'disabled', 'duplicate')`), /UNIQUE/);
    store.close();
    assert.deepEqual(compare(schemaOf(path), schemaOf(freshPath(fx))), { differ: {}, reordered: [] });
  } finally { fx.cleanup(); }
});
