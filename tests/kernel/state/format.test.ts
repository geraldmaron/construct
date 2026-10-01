/**
 * tests/kernel/state/format.test.ts — format 4 is created fresh; formats 2 and 3
 * upgrade one way when asked; anything else is refused unread.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openStateStore } from '../../../src/kernel/state/open.ts';
import {
  STATE_FORMAT_ID,
  STATE_FORMAT_VERSION,
  UNSUPPORTED_STATE_MESSAGE,
  UnsupportedStateError,
} from '../../../src/kernel/state/format.ts';
import { REQUIRED_TABLES } from '../../../src/kernel/state/schema.ts';
import { FORMAT4_COLUMNS } from '../../../src/kernel/state/migrate.ts';
import { appendActivity, listActivity } from '../../../src/kernel/state/activity.ts';
import { addSource } from '../../../src/kernel/state/sources.ts';
import { freshStore, clock } from './support.ts';

function tmp(): { root: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), 'construct-format-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('a fresh open creates one database stamped format 4, plus only its WAL sidecars', () => {
  const fx = freshStore();
  try {
    const meta = Object.fromEntries(
      (fx.store.db.prepare('SELECT key, value FROM meta').all() as Array<{ key: string; value: string }>).map(
        (r) => [r.key, r.value],
      ),
    );
    assert.equal(meta.format, STATE_FORMAT_ID);
    assert.equal(meta.format_version, String(STATE_FORMAT_VERSION));
    assert.equal(STATE_FORMAT_VERSION, 4);
    const files = readdirSync(dirname(fx.dbPath)).sort();
    assert.deepEqual(files.filter((f) => !/^construct\.sqlite-(?:wal|shm)$/.test(f)), ['construct.sqlite']);
    const tables = new Set(
      (fx.store.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map(
        (r) => r.name,
      ),
    );
    for (const required of REQUIRED_TABLES) assert.ok(tables.has(required), `missing table ${required}`);
    assert.equal(fx.store.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1);
  } finally {
    fx.cleanup();
  }
});

test('reopening a current store works and keeps its rows', () => {
  const fx = freshStore();
  try {
    const at = clock();
    addSource(fx.store, {
      id: 'src-1', kind: 'repo', purpose: 'the code', authorityLevel: 'authoritative',
      sensitivity: 'internal', canRead: true, canWrite: false, at: at(),
    });
    fx.store.close();
    const again = openStateStore(fx.dbPath);
    const count = again.db.prepare('SELECT COUNT(*) AS n FROM sources').get() as { n: number };
    assert.equal(count.n, 1);
    again.close();
  } finally {
    fx.cleanup();
  }
});

test('a format-1 store is refused with the reset instruction and is not read', () => {
  const { root, cleanup } = tmp();
  try {
    const path = join(root, 'construct.sqlite');
    const db = new DatabaseSync(path);
    db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             INSERT INTO meta VALUES ('format', 'construct-state'), ('format_version', '1');
             CREATE TABLE runs (id TEXT PRIMARY KEY, outcome TEXT NOT NULL);
             INSERT INTO runs VALUES ('r1', 'old outcome');`);
    db.close();
    assert.throws(
      () => openStateStore(path),
      (err: unknown) =>
        err instanceof UnsupportedStateError &&
        err.message === UNSUPPORTED_STATE_MESSAGE &&
        err.foundFormat === 'construct-state' &&
        err.foundVersion === 1,
    );
    // Untouched: the old rows are still there and no format-2 table was added.
    const check = new DatabaseSync(path);
    const tables = check.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as Array<{ name: string }>;
    assert.deepEqual(tables.map((t) => t.name), ['meta', 'runs']);
    check.close();
  } finally {
    cleanup();
  }
});

test('a schema-numbered home store (no format id) is refused without parsing', () => {
  const { root, cleanup } = tmp();
  try {
    const path = join(root, 'construct.db');
    const db = new DatabaseSync(path);
    db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             INSERT INTO meta VALUES ('schema_version', '24');
             CREATE TABLE work_log (id INTEGER PRIMARY KEY);`);
    db.close();
    assert.throws(
      () => openStateStore(path),
      (err: unknown) => err instanceof UnsupportedStateError && err.foundFormat === null && err.foundVersion === 24,
    );
  } finally {
    cleanup();
  }
});

test('a sqlite file with tables but no meta is refused', () => {
  const { root, cleanup } = tmp();
  try {
    const path = join(root, 'other.sqlite');
    const db = new DatabaseSync(path);
    db.exec('CREATE TABLE something (id TEXT)');
    db.close();
    assert.throws(() => openStateStore(path), UnsupportedStateError);
  } finally {
    cleanup();
  }
});

test('a format-2 store missing a required table is refused rather than repaired', () => {
  const fx = freshStore();
  try {
    fx.store.close();
    const db = new DatabaseSync(fx.dbPath);
    db.exec('DROP TABLE lessons');
    db.close();
    assert.throws(() => openStateStore(fx.dbPath), UnsupportedStateError);
  } finally {
    fx.cleanup();
  }
});

test('the activity table refuses updates and deletes at the database', () => {
  const fx = freshStore();
  try {
    const event = appendActivity(fx.store, { at: clock()(), kind: 'test.event', payload: { a: 1 } });
    assert.throws(() => fx.store.db.prepare('UPDATE activity_events SET kind = ? WHERE id = ?').run('x', event.id), /append-only/);
    assert.throws(() => fx.store.db.prepare('DELETE FROM activity_events WHERE id = ?').run(event.id), /append-only/);
    assert.equal(listActivity(fx.store).length, 1);
  } finally {
    fx.cleanup();
  }
});

test('a transaction that throws leaves nothing behind', () => {
  const fx = freshStore();
  try {
    const at = clock();
    assert.throws(() =>
      fx.store.transaction(() => {
        appendActivity(fx.store, { at: at(), kind: 'inside', payload: {} });
        throw new Error('boom');
      }),
    );
    assert.equal(listActivity(fx.store).length, 0);
    fx.store.transaction(() => {
      appendActivity(fx.store, { at: at(), kind: 'outer', payload: {} });
      fx.store.transaction(() => appendActivity(fx.store, { at: at(), kind: 'nested', payload: {} }));
    });
    assert.deepEqual(listActivity(fx.store).map((e) => e.kind), ['outer', 'nested']);
  } finally {
    fx.cleanup();
  }
});

test('foreign keys are enforced', () => {
  const fx = freshStore();
  try {
    assert.throws(
      () =>
        fx.store.db
          .prepare(`INSERT INTO source_authority (source_id, claim_type, authoritative) VALUES ('nope', 'x', 1)`)
          .run(),
      /FOREIGN KEY/,
    );
  } finally {
    fx.cleanup();
  }
});

test('a complete format-2 store upgrades only when asked, in place, and keeps its rows', () => {
  const fx = freshStore();
  try {
    const at = clock();
    addSource(fx.store, {
      id: 'src-1', kind: 'repo', purpose: 'the code', authorityLevel: 'authoritative',
      sensitivity: 'internal', canRead: true, canWrite: false, at: at(),
    });
    fx.store.close();
    const db = new DatabaseSync(fx.dbPath);
    db.exec('PRAGMA foreign_keys = OFF');
    for (const table of ['run_bindings', 'reviews', 'work_runs', 'work_legacy_ids', 'work_events', 'work_dependencies', 'work_items']) {
      db.exec(`DROP TABLE IF EXISTS ${table}`);
    }
    db.prepare(`UPDATE meta SET value = '2' WHERE key = 'format_version'`).run();
    db.close();
    assert.throws(() => openStateStore(fx.dbPath), (err: unknown) => err instanceof UnsupportedStateError && err.kind === 'older');
    assert.throws(() => openStateStore(fx.dbPath, { readOnly: true, migrate: true }), (err: unknown) => err instanceof UnsupportedStateError && err.kind === 'older');
    const again = openStateStore(fx.dbPath, { migrate: true });
    const meta = again.db.prepare(`SELECT value FROM meta WHERE key = 'format_version'`).get() as { value: string };
    assert.equal(meta.value, '4');
    const tables = new Set(
      (again.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map((r) => r.name),
    );
    assert.ok(tables.has('work_items'));
    const count = again.db.prepare('SELECT COUNT(*) AS n FROM sources').get() as { n: number };
    assert.equal(count.n, 1);
    again.close();
  } finally {
    fx.cleanup();
  }
});

/** Every table's columns in order, and every index by name: the physical shape a migration must reproduce. */
function shape(db: DatabaseSync): Record<string, unknown> {
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ name: string }>).map((r) => r.name);
  const out: Record<string, unknown> = {};
  for (const t of tables) out[t] = (db.prepare(`PRAGMA table_info("${t}")`).all() as Array<{ name: string; type: string; notnull: number; pk: number }>).map((c) => `${c.name} ${c.type}${c.notnull ? ' NOT NULL' : ''}${c.pk ? ' PK' : ''}`);
  out['#indexes'] = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ name: string }>).map((r) => r.name);
  return out;
}

test('a format-3 store upgraded to format 4 has exactly the shape of a fresh one, and keeps its rows', () => {
  const fresh = freshStore();
  const old = freshStore();
  try {
    const at = clock();
    addSource(old.store, {
      id: 'src-1', kind: 'repo', purpose: 'the code', authorityLevel: 'authoritative',
      sensitivity: 'internal', canRead: true, canWrite: false, at: at(),
    });
    old.store.close();
    const db = new DatabaseSync(old.dbPath);
    db.exec('PRAGMA foreign_keys = OFF');
    for (const t of ['path_leases', 'session_agents', 'sessions']) db.exec(`DROP TABLE ${t}`);
    for (const [table, column] of FORMAT4_COLUMNS) db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    db.prepare(`UPDATE meta SET value = '3' WHERE key = 'format_version'`).run();
    db.close();
    assert.throws(() => openStateStore(old.dbPath), (err: unknown) => err instanceof UnsupportedStateError && err.kind === 'older');
    const upgraded = openStateStore(old.dbPath, { migrate: true });
    assert.equal(upgraded.migratedFrom, 3);
    assert.deepEqual(shape(upgraded.db), shape(fresh.store.db));
    assert.equal((upgraded.db.prepare('SELECT COUNT(*) AS n FROM sources').get() as { n: number }).n, 1);
    upgraded.close();
  } finally {
    fresh.cleanup();
    old.cleanup();
  }
});
