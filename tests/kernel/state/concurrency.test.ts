/**
 * tests/kernel/state/concurrency.test.ts — one process's view of a store other
 * processes share: WAL and a lock wait are set, the file is owner-only, a busy
 * begin leaves the connection able to run real transactions, a nested failure
 * undoes only its own writes, and newer or older formats are refused with an
 * instruction that never discards state.
 *
 * Contention across real processes is covered by tests/concurrency/.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { BUSY_TIMEOUT_MS, openStateStore } from '../../../src/kernel/state/open.ts';
import { NEWER_STATE_MESSAGE, StateBusyError, UnsupportedStateError } from '../../../src/kernel/state/format.ts';
import { appendActivity, listActivity } from '../../../src/kernel/state/activity.ts';
import { freshStore, clock } from './support.ts';

test('a writable open runs in WAL with a lock wait and leaves the file owner-only', () => {
  const fx = freshStore();
  try {
    assert.equal(fx.store.journalMode, 'wal');
    assert.equal((fx.store.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode, 'wal');
    assert.ok((fx.store.db.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout >= 1000);
    assert.equal(statSync(fx.dbPath).mode & 0o777, 0o600);
  } finally {
    fx.cleanup();
  }
});

test('a busy begin leaves the next transaction atomic', () => {
  const fx = freshStore();
  try {
    fx.store.close();
    const store = openStateStore(fx.dbPath, { busyTimeoutMs: 20 });
    const holder = new DatabaseSync(fx.dbPath);
    holder.exec('BEGIN EXCLUSIVE');
    const at = clock();
    assert.throws(() => store.transaction(() => appendActivity(store, { at: at(), kind: 'blocked', payload: {} })), StateBusyError);
    holder.exec('ROLLBACK');
    holder.close();

    assert.throws(() =>
      store.transaction(() => {
        appendActivity(store, { at: at(), kind: 'partial', payload: {} });
        throw new Error('boom');
      }),
    );
    assert.equal(listActivity(store).length, 0, 'a transaction after a busy begin must still roll back as one unit');
    store.close();
  } finally {
    fx.cleanup();
  }
});

test('a nested failure undoes only its own writes', () => {
  const fx = freshStore();
  try {
    const at = clock();
    fx.store.transaction(() => {
      appendActivity(fx.store, { at: at(), kind: 'outer', payload: {} });
      assert.throws(() =>
        fx.store.transaction(() => {
          appendActivity(fx.store, { at: at(), kind: 'inner', payload: {} });
          throw new Error('inner fails');
        }),
      );
    });
    assert.deepEqual(listActivity(fx.store).map((e) => e.kind), ['outer']);
  } finally {
    fx.cleanup();
  }
});

test('a newer format is refused with the upgrade instruction and is not changed', () => {
  const fx = freshStore();
  try {
    fx.store.close();
    const db = new DatabaseSync(fx.dbPath);
    db.prepare(`UPDATE meta SET value = '99' WHERE key = 'format_version'`).run();
    db.close();
    assert.throws(
      () => openStateStore(fx.dbPath),
      (err: unknown) => err instanceof UnsupportedStateError && err.kind === 'newer' && err.message === NEWER_STATE_MESSAGE && !/reset`/.test(err.message.split('\n')[1] ?? ''),
    );
    const check = new DatabaseSync(fx.dbPath);
    assert.equal((check.prepare(`SELECT value FROM meta WHERE key = 'format_version'`).get() as { value: string }).value, '99');
    check.close();
  } finally {
    fx.cleanup();
  }
});

test('a read-only open never writes: no stamp, no migration, no journal change', () => {
  const fx = freshStore();
  try {
    fx.store.close();
    const db = new DatabaseSync(fx.dbPath);
    db.exec('PRAGMA journal_mode = DELETE');
    db.close();
    const before = statSync(fx.dbPath).mtimeMs;
    const ro = openStateStore(fx.dbPath, { readOnly: true });
    assert.equal(ro.readOnly, true);
    assert.equal(ro.journalMode, 'delete');
    assert.throws(() => ro.db.prepare(`INSERT INTO meta (key, value) VALUES ('x', 'y')`).run(), /readonly/i);
    ro.close();
    assert.equal(statSync(fx.dbPath).mtimeMs, before);
  } finally {
    fx.cleanup();
  }
});

test('the transaction after a busy begin holds the write lock, as a real BEGIN IMMEDIATE does', () => {
  const fx = freshStore();
  try {
    fx.store.close();
    const store = openStateStore(fx.dbPath, { busyTimeoutMs: 20 });
    const holder = new DatabaseSync(fx.dbPath);
    holder.exec('BEGIN EXCLUSIVE');
    assert.throws(() => store.transaction(() => null), StateBusyError);
    holder.exec('ROLLBACK');
    const rival = new DatabaseSync(fx.dbPath);
    rival.exec('PRAGMA busy_timeout = 0');
    store.transaction(() => {
      assert.throws(() => rival.exec('BEGIN IMMEDIATE'), /locked/, 'a second writer must be shut out for the whole transaction');
    });
    rival.close();
    holder.close();
    store.close();
  } finally {
    fx.cleanup();
  }
});

test('connections wait the configured time for a lock, and a lock released during the retry window is waited out', async () => {
  const fx = freshStore();
  try {
    assert.equal((fx.store.db.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout, BUSY_TIMEOUT_MS);
    assert.equal(BUSY_TIMEOUT_MS, 5000);
    fx.store.close();
    const store = openStateStore(fx.dbPath, { busyTimeoutMs: 20 });
    const worker = new Worker(
      `const { DatabaseSync } = require('node:sqlite'); const { parentPort, workerData } = require('node:worker_threads');
       const db = new DatabaseSync(workerData); db.exec('BEGIN EXCLUSIVE'); parentPort.postMessage('locked');
       Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40); db.exec('ROLLBACK'); db.close(); parentPort.postMessage('released');`,
      { eval: true, workerData: fx.dbPath },
    );
    await new Promise<void>((resolve) => worker.once('message', () => resolve()));
    const at = clock();
    store.transaction(() => appendActivity(store, { at: at(), kind: 'after-retry', payload: {} }));
    assert.deepEqual(listActivity(store).map((e) => e.kind), ['after-retry']);
    await worker.terminate();
    store.close();
  } finally {
    fx.cleanup();
  }
});

test('when SQLite itself aborts inside a nested call, the original error surfaces and nothing after it commits', () => {
  const fx = freshStore();
  try {
    const at = clock();
    fx.store.db.exec(`CREATE TEMP TRIGGER abort_on_boom BEFORE INSERT ON activity_events WHEN NEW.kind = 'boom' BEGIN SELECT RAISE(ROLLBACK, 'boom rolled back the transaction'); END;`);
    assert.throws(
      () =>
        fx.store.transaction(() => {
          appendActivity(fx.store, { at: at(), kind: 'before', payload: {} });
          try {
            fx.store.transaction(() => appendActivity(fx.store, { at: at(), kind: 'boom', payload: {} }));
          } catch {
            // A caller that swallows the nested failure and carries on.
          }
          fx.store.db.prepare(`INSERT INTO meta (key, value) VALUES ('escaped', 'yes')`).run();
          return null;
        }),
      /boom rolled back the transaction/,
    );
    assert.equal(listActivity(fx.store).length, 0);
    assert.equal(fx.store.db.prepare(`SELECT value FROM meta WHERE key = 'escaped'`).get(), undefined, 'a write after the abort must not commit on its own');
    fx.store.transaction(() => appendActivity(fx.store, { at: at(), kind: 'later', payload: {} }));
    assert.deepEqual(listActivity(fx.store).map((e) => e.kind), ['later']);
  } finally {
    fx.cleanup();
  }
});

test('a write transaction refuses a store another build re-stamped, even without a schema change', () => {
  const fx = freshStore();
  try {
    const at = clock();
    const other = new DatabaseSync(fx.dbPath);
    other.prepare(`UPDATE meta SET value = '99' WHERE key = 'format_version'`).run();
    other.close();
    assert.throws(() => fx.store.transaction(() => appendActivity(fx.store, { at: at(), kind: 'late', payload: {} })), (err: unknown) => err instanceof UnsupportedStateError && err.kind === 'newer');
    const check = new DatabaseSync(fx.dbPath);
    assert.equal((check.prepare('SELECT COUNT(*) AS n FROM activity_events').get() as { n: number }).n, 0);
    check.close();
  } finally {
    fx.cleanup();
  }
});

test('a store this build refuses is left exactly as found: no journal switch, no permission change', () => {
  const fx = freshStore();
  try {
    fx.store.close();
    const db = new DatabaseSync(fx.dbPath);
    db.exec('PRAGMA journal_mode = DELETE');
    db.prepare(`UPDATE meta SET value = '99' WHERE key = 'format_version'`).run();
    db.close();
    chmodSync(fx.dbPath, 0o644);
    const before = readFileSync(fx.dbPath);
    assert.throws(() => openStateStore(fx.dbPath), UnsupportedStateError);
    assert.ok(readFileSync(fx.dbPath).equals(before));
    assert.equal(statSync(fx.dbPath).mode & 0o777, 0o644);
  } finally {
    fx.cleanup();
  }
});

test('a writer does not stall behind a reader to switch journals; it switches on a later open', () => {
  const fx = freshStore();
  try {
    fx.store.close();
    const setup = new DatabaseSync(fx.dbPath);
    setup.exec('PRAGMA journal_mode = DELETE');
    setup.close();
    const reader = new DatabaseSync(fx.dbPath);
    reader.exec('BEGIN');
    reader.prepare('SELECT COUNT(*) FROM meta').get();
    const started = Date.now();
    const store = openStateStore(fx.dbPath);
    assert.ok(Date.now() - started < 3000, `open took ${String(Date.now() - started)} ms behind a reader`);
    assert.equal(store.journalMode, 'delete');
    store.close();
    reader.exec('COMMIT');
    reader.close();
    const later = openStateStore(fx.dbPath);
    assert.equal(later.journalMode, 'wal');
    later.close();
  } finally {
    fx.cleanup();
  }
});

test('a reader that finds the store mid-creation is told to wait, never to reset', () => {
  const fx = freshStore();
  try {
    fx.store.close();
    const empty = `${fx.dbPath}.empty`;
    writeFileSync(empty, '');
    assert.throws(() => openStateStore(empty, { readOnly: true }), StateBusyError);
  } finally {
    fx.cleanup();
  }
});

test('a read-only open of a WAL store in a directory this user cannot write still reads it, and says what access a stale log needs', () => {
  const fx = freshStore();
  const dir = dirname(fx.dbPath);
  try {
    appendActivity(fx.store, { kind: 'test.before', at: clock()() });
    fx.store.close();
    chmodSync(dir, 0o555);
    const reader = openStateStore(fx.dbPath, { readOnly: true });
    try {
      assert.equal(reader.journalMode, 'wal');
      assert.ok(listActivity(reader).some((e) => e.kind === 'test.before'));
    } finally {
      reader.close();
    }

    // A live writer's shared-memory file is already there: its pending write is read, not missed.
    chmodSync(dir, 0o755);
    const writer = new DatabaseSync(fx.dbPath);
    writer.exec('PRAGMA wal_autocheckpoint = 0');
    writer.prepare(`INSERT INTO meta (key, value) VALUES ('pending', '1')`).run();
    const log = readFileSync(`${fx.dbPath}-wal`);
    chmodSync(dir, 0o555);
    const live = openStateStore(fx.dbPath, { readOnly: true });
    try {
      assert.equal((live.db.prepare(`SELECT value FROM meta WHERE key = 'pending'`).get() as { value: string } | undefined)?.value, '1');
    } finally {
      live.close();
    }

    // A log left behind with no shared-memory file cannot be read safely here.
    chmodSync(dir, 0o755);
    writer.close();
    writeFileSync(`${fx.dbPath}-wal`, log);
    rmSync(`${fx.dbPath}-shm`, { force: true });
    chmodSync(dir, 0o555);
    assert.throws(() => openStateStore(fx.dbPath, { readOnly: true }), /non-empty write-ahead log, and reading it safely needs SQLite's shared-memory file/);
  } finally {
    chmodSync(dir, 0o755);
    fx.cleanup();
  }
});
