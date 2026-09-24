/**
 * tests/cli/migrate.test.ts — only `construct migrate` changes a store's
 * format, and it writes a backup first. Commands that read leave an older
 * store byte for byte as they found it, and a newer store is never touched.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { sterile, type SterileFixture } from '../harness/sterile.ts';

const LAUNCHER = fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url));

function cli(fx: SterileFixture, cwd: string, args: string[]): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [LAUNCHER, ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: join(fx.root, 'home'), XDG_CONFIG_HOME: fx.paths.configDir, XDG_STATE_HOME: fx.paths.stateDir, XDG_DATA_HOME: fx.paths.dataDir, XDG_CACHE_HOME: fx.paths.cacheDir, NO_COLOR: '1' },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

function project(fx: SterileFixture): { dir: string; db: string } {
  const dir = join(fx.root, 'project');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(fx.root, 'home'), { recursive: true });
  assert.equal(cli(fx, dir, ['init', '--no-wire', '--name=migrate', '--scale=solo']).status, 0);
  assert.equal(cli(fx, dir, ['work', 'add', 'kept across the upgrade']).status, 0);
  return { dir, db: join(dir, '.construct', 'state', 'construct.sqlite') };
}

/** Rewind a format-3 store to a complete format-2 store, as an earlier build left it. */
function toFormat2(db: string): void {
  const d = new DatabaseSync(db);
  d.exec('PRAGMA journal_mode = DELETE');
  d.exec('PRAGMA foreign_keys = OFF');
  d.exec(`CREATE TABLE keep_work AS SELECT * FROM work_items`);
  for (const table of ['run_bindings', 'reviews', 'work_runs', 'work_legacy_ids', 'work_events', 'work_dependencies', 'work_items']) d.exec(`DROP TABLE IF EXISTS ${table}`);
  d.prepare(`UPDATE meta SET value = '2' WHERE key = 'format_version'`).run();
  d.close();
}

test('a read-only command refuses an older store with the migrate step and leaves it byte-identical', () => {
  const fx = sterile();
  try {
    const { dir, db } = project(fx);
    toFormat2(db);
    const before = readFileSync(db);
    const status = cli(fx, dir, ['status']);
    assert.notEqual(status.status, 0);
    assert.match(status.out, /construct migrate/);
    assert.doesNotMatch(status.out, /construct reset/);
    assert.ok(readFileSync(db).equals(before), 'status must not change the file');
  } finally {
    fx.cleanup();
  }
});

test('migrate backs up an older store, upgrades it, and then has nothing to do', () => {
  const fx = sterile();
  try {
    const { dir, db } = project(fx);
    toFormat2(db);
    const first = cli(fx, dir, ['migrate', '--json']);
    assert.equal(first.status, 0, first.out);
    const record = JSON.parse(first.out.trim().split('\n').pop()!) as { migrated: boolean; from: number; backup: string };
    assert.equal(record.migrated, true);
    assert.equal(record.from, 2);
    assert.ok(readdirSync(join(dir, '.construct', 'state')).some((f) => /^construct\.pre-v2-\d+-[0-9a-f]+\.sqlite$/.test(f)));
    const backup = new DatabaseSync(record.backup, { readOnly: true });
    assert.equal((backup.prepare(`SELECT value FROM meta WHERE key = 'format_version'`).get() as { value: string }).value, '2');
    backup.close();
    const upgraded = new DatabaseSync(db, { readOnly: true });
    assert.equal((upgraded.prepare(`SELECT value FROM meta WHERE key = 'format_version'`).get() as { value: string }).value, '3');
    upgraded.close();
    const second = cli(fx, dir, ['migrate', '--json']);
    assert.equal(second.status, 0);
    assert.equal((JSON.parse(second.out.trim().split('\n').pop()!) as { migrated: boolean }).migrated, false);
    assert.equal(cli(fx, dir, ['work', 'list']).status, 0);
  } finally {
    fx.cleanup();
  }
});

test('migrate refuses a newer store and leaves it as it was', () => {
  const fx = sterile();
  try {
    const { dir, db } = project(fx);
    const d = new DatabaseSync(db);
    d.prepare(`UPDATE meta SET value = '99' WHERE key = 'format_version'`).run();
    d.close();
    const before = readFileSync(db);
    const r = cli(fx, dir, ['migrate']);
    assert.notEqual(r.status, 0);
    assert.match(r.out, /newer version of Construct/);
    assert.ok(readFileSync(db).equals(before));
    assert.equal(readdirSync(join(dir, '.construct', 'state')).filter((f) => f.includes('pre-v')).length, 0);
  } finally {
    fx.cleanup();
  }
});

function envOf(fx: SterileFixture): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, HOME: join(fx.root, 'home'), XDG_CONFIG_HOME: fx.paths.configDir, XDG_STATE_HOME: fx.paths.stateDir, XDG_DATA_HOME: fx.paths.dataDir, XDG_CACHE_HOME: fx.paths.cacheDir, NO_COLOR: '1' };
}

function rowCounts(db: string, tables: readonly string[]): Record<string, number> {
  const d = new DatabaseSync(db, { readOnly: true });
  try {
    return Object.fromEntries(tables.map((t) => [t, (d.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n]));
  } finally {
    d.close();
  }
}

test('every row an older store holds is still there after migrate', () => {
  const fx = sterile();
  try {
    const { dir, db } = project(fx);
    toFormat2(db);
    const d = new DatabaseSync(db, { readOnly: true });
    const tables = (d.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>).map((r) => r.name);
    d.close();
    const before = rowCounts(db, tables);
    assert.ok(Object.values(before).some((n) => n > 0), 'the fixture carries rows');
    assert.equal(cli(fx, dir, ['migrate']).status, 0);
    const after = rowCounts(db, tables.filter((t) => t !== 'meta'));
    for (const [table, n] of Object.entries(after)) assert.equal(n, before[table], `${table} rows`);
  } finally {
    fx.cleanup();
  }
});

test('migrates that race: all finish, exactly one upgrades, and one owner-only backup remains', async () => {
  const fx = sterile();
  try {
    const { dir, db } = project(fx);
    toFormat2(db);
    const runs = await Promise.all(Array.from({ length: 3 }, () => new Promise<{ status: number | null; out: string }>((resolve) => {
      const child = spawn(process.execPath, [LAUNCHER, 'migrate', '--json'], { cwd: dir, env: envOf(fx) });
      let out = '';
      child.stdout.on('data', (c) => (out += String(c)));
      child.stderr.on('data', (c) => (out += String(c)));
      child.on('close', (status) => resolve({ status, out }));
    })));
    for (const r of runs) assert.equal(r.status, 0, r.out);
    const reports = runs.map((r) => JSON.parse(r.out.trim().split('\n').pop()!) as { migrated: boolean });
    assert.equal(reports.filter((r) => r.migrated).length, 1);
    const backups = readdirSync(join(dir, '.construct', 'state')).filter((f) => f.startsWith('construct.pre-v'));
    assert.equal(backups.length, 1, backups.join(', '));
    assert.equal(statSync(join(dir, '.construct', 'state', backups[0]!)).mode & 0o777, 0o600);
  } finally {
    fx.cleanup();
  }
});

test('reset refuses while another process has the store open, and --force leaves a fresh store with no stale log', async () => {
  const fx = sterile();
  try {
    const { dir, db } = project(fx);
    const holder = spawn(process.execPath, ['-e', `const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(${JSON.stringify(db)}); d.prepare('SELECT 1').get(); process.stdout.write('open\\n'); setTimeout(() => {}, 60000);`]);
    await new Promise<void>((resolve) => holder.stdout.once('data', () => resolve()));
    try {
      const refused = cli(fx, dir, ['reset', '--confirm']);
      assert.notEqual(refused.status, 0);
      assert.match(refused.out, /open in 1 other process/);
      assert.ok(existsSync(db), 'nothing removed');
      const forced = cli(fx, dir, ['reset', '--confirm', '--force']);
      assert.equal(forced.status, 0, forced.out);
    } finally {
      holder.kill();
    }
    assert.equal(cli(fx, dir, ['status']).status, 0, 'the recreated store is readable');
    assert.equal(cli(fx, dir, ['work', 'add', 'after reset']).status, 0);
  } finally {
    fx.cleanup();
  }
});
