/**
 * tests/kernel/store/erasure.test.ts — removing a subject who asked to be
 * removed, from a store that is otherwise append-only.
 *
 * The properties held here: deletion stays refused everywhere except inside an
 * erasure, the erasure itself is recorded and carries no erased content, the
 * permission is taken back even when the erasure fails, and a note naming a
 * second subject is reported rather than destroyed on the first one's behalf.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import type { Store } from '../../../src/kernel/store/open.ts';
import { addRecord, currentFields, getRecord, updateRecordField } from '../../../src/kernel/store/records.ts';
import { notesFor, recordNote } from '../../../src/kernel/store/notes.ts';
import { eraseNote, eraseRecord, erasuresFor } from '../../../src/kernel/store/erasure.ts';

const AT = '2026-08-13T00:00:00.000Z';
const LATER = '2026-08-14T00:00:00.000Z';

function withStore<T>(fn: (store: Store) => T): T {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    return fn(store);
  } finally {
    store.close();
    fixture.cleanup();
  }
}

function seed(store: Store): void {
  addRecord(store, { id: 'rec-acme', workspace: 'default', kind: 'customer', name: 'Acme', createdAt: AT });
  for (const [value, at] of [['Q2', AT], ['Q3', LATER]] as const) {
    updateRecordField(store, {
      record: 'rec-acme',
      field: 'renewal',
      value,
      citation: 'note:n-1#L1',
      recordedAt: at,
    });
  }
  recordNote(store, {
    id: 'n-1',
    workspace: 'default',
    run: null,
    door: 'file-drop',
    body: 'Acme moved the renewal to Q3',
    recordedAt: AT,
  });
  recordNote(store, {
    id: 'n-2',
    workspace: 'default',
    run: null,
    door: 'file-drop',
    body: 'Acme and Globex both want the pilot',
    recordedAt: AT,
  });
  recordNote(store, {
    id: 'n-3',
    workspace: 'default',
    run: null,
    door: 'file-drop',
    body: 'Globex signed on its own',
    recordedAt: AT,
  });
}

test('an erasure removes the subject and every value its fields ever held', () => {
  withStore((store) => {
    seed(store);
    const { erased } = eraseRecord(store, 'rec-acme', 'the customer asked to be forgotten', LATER);
    assert.equal(getRecord(store, 'rec-acme'), null);
    assert.equal(currentFields(store, 'rec-acme').length, 0);
    assert.equal(erased.removed, 3, 'two field values and the subject itself');
    assert.equal(
      store.db.prepare('SELECT COUNT(*) AS n FROM record_fields').get()?.n,
      0,
      'the earlier value is gone too, not just the current one',
    );
  });
});

test('the erasure is recorded, and the record of it holds nothing that was erased', () => {
  withStore((store) => {
    seed(store);
    eraseRecord(store, 'rec-acme', 'the customer asked to be forgotten', LATER);
    const [logged] = erasuresFor(store, 'default');
    assert.equal(logged?.kind, 'record');
    assert.equal(logged?.subject, 'rec-acme', 'an id, never the name — the name is the thing erased');
    assert.equal(logged?.removed, 3);
    assert.doesNotMatch(JSON.stringify(logged), /Acme|Q2|Q3/, 'an erasure log that quoted its subject is the leak');
  });
});

test('a note naming a second subject is reported, never destroyed on the first one behalf', () => {
  withStore((store) => {
    seed(store);
    const { notesStillNaming } = eraseRecord(store, 'rec-acme', 'asked to be forgotten', LATER);
    assert.deepEqual(notesStillNaming.map((n) => n.id), ['n-1', 'n-2']);
    assert.equal(notesFor(store, 'default').length, 3, 'reporting is not removing');

    // The single-subject note goes; the shared one is the user's judgment.
    eraseNote(store, 'n-1', 'it is only about the erased subject', LATER);
    assert.deepEqual(notesFor(store, 'default').map((n) => n.id), ['n-2', 'n-3']);
    assert.equal(erasuresFor(store, 'default').length, 2);
  });
});

test('deletion stays refused outside an erasure, and the permission is taken back after one', () => {
  withStore((store) => {
    seed(store);
    assert.throws(() => store.db.prepare('DELETE FROM notes').run(), /never deleted outside an erasure/);
    assert.throws(() => store.db.prepare('DELETE FROM record_fields').run(), /append-only outside an erasure/);

    eraseNote(store, 'n-3', 'no longer relevant', LATER);

    // The unlock lived for one transaction, not for the process.
    assert.throws(() => store.db.prepare('DELETE FROM notes').run(), /never deleted outside an erasure/);
    assert.throws(() => store.db.prepare('DELETE FROM record_fields').run(), /append-only outside an erasure/);
  });
});

test('a failed erasure leaves the store locked and unchanged, not half-open', () => {
  withStore((store) => {
    seed(store);
    assert.throws(() => eraseRecord(store, 'rec-nobody', 'asked', LATER), /no record rec-nobody/);
    assert.throws(() => store.db.prepare('DELETE FROM notes').run(), /never deleted outside an erasure/);
    assert.equal(notesFor(store, 'default').length, 3);
    assert.equal(erasuresFor(store, 'default').length, 0);
  });
});

test('an erasure with no stated reason is refused: an unauditable erasure is not one', () => {
  withStore((store) => {
    seed(store);
    assert.throws(() => eraseRecord(store, 'rec-acme', '   ', LATER), /no stated reason/);
    assert.throws(() => eraseNote(store, 'n-1', '', LATER), /no stated reason/);
    assert.equal(getRecord(store, 'rec-acme')?.name, 'Acme');
  });
});

test('the fact of an erasure is not itself erasable', () => {
  withStore((store) => {
    seed(store);
    eraseNote(store, 'n-3', 'no longer relevant', LATER);
    assert.throws(() => store.db.prepare('DELETE FROM erasures').run(), /append-only/);
    assert.throws(() => store.db.prepare('UPDATE erasures SET reason = ?').run('x'), /append-only/);
  });
});
