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
import { statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { openStateStore } from '../../../src/kernel/state/open.ts';
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
