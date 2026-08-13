/**
 * tests/kernel/store/records.test.ts — the subjects a workspace keeps facts
 * about.
 *
 * The properties held here: identity is unique within a workspace, because two
 * records for one subject split its history and half a history reads like a
 * whole one; a field's current value is its most recent row and the rows before
 * it survive, so "when did it change and what said so" stays answerable; and an
 * uncited value is refused, because a record is exactly the surface where an
 * unsourced fact would later be quoted as established.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import type { Store } from '../../../src/kernel/store/open.ts';
import {
  addRecord,
  currentFields,
  fieldHistory,
  findRecord,
  getRecord,
  recordsFor,
  updateRecordField,
} from '../../../src/kernel/store/records.ts';

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

function acme(store: Store, id = 'rec-1'): void {
  addRecord(store, { id, workspace: 'default', kind: 'customer', name: 'Acme', createdAt: AT });
}

test('a record is found by what a person calls it, and only within its own workspace', () => {
  withStore((store) => {
    acme(store);
    assert.equal(findRecord(store, 'default', 'customer', 'Acme')?.id, 'rec-1');
    assert.equal(findRecord(store, 'other', 'customer', 'Acme'), null);
    assert.equal(findRecord(store, 'default', 'vendor', 'Acme'), null);
    assert.deepEqual(recordsFor(store, 'default').map((r) => r.id), ['rec-1']);
  });
});

test('one workspace cannot keep two records for the same subject', () => {
  withStore((store) => {
    acme(store);
    assert.throws(() => acme(store, 'rec-2'), /UNIQUE/i);
    // A different workspace is a different subject, and may keep its own.
    addRecord(store, { id: 'rec-3', workspace: 'other', kind: 'customer', name: 'Acme', createdAt: AT });
    assert.equal(getRecord(store, 'rec-3')?.workspace, 'other');
  });
});

test('a new value supersedes without erasing how the field got there', () => {
  withStore((store) => {
    acme(store);
    updateRecordField(store, {
      record: 'rec-1',
      field: 'renewal',
      value: 'Q2',
      citation: 'note:n-1#L2',
      recordedAt: AT,
    });
    updateRecordField(store, {
      record: 'rec-1',
      field: 'renewal',
      value: 'Q3',
      citation: 'note:n-2#L1',
      recordedAt: LATER,
    });
    updateRecordField(store, {
      record: 'rec-1',
      field: 'owner',
      value: 'Dana',
      citation: 'note:n-2#L4',
      recordedAt: LATER,
    });

    const current = currentFields(store, 'rec-1');
    assert.equal(current.length, 2, 'one row per field, not one per change');
    assert.equal(current.find((f) => f.field === 'renewal')?.value, 'Q3');
    assert.equal(current.find((f) => f.field === 'renewal')?.citation, 'note:n-2#L1');

    const history = fieldHistory(store, 'rec-1', 'renewal');
    assert.deepEqual(history.map((h) => h.value), ['Q2', 'Q3']);
    assert.deepEqual(history.map((h) => h.citation), ['note:n-1#L2', 'note:n-2#L1']);
  });
});

test('a value with nothing behind it is refused: a record is not a place for unsourced facts', () => {
  withStore((store) => {
    acme(store);
    assert.throws(
      () =>
        updateRecordField(store, {
          record: 'rec-1',
          field: 'renewal',
          value: 'Q3',
          citation: '  ',
          recordedAt: AT,
        }),
      /cites nothing/,
    );
    assert.equal(currentFields(store, 'rec-1').length, 0);
  });
});

test('field history is append-only: a value cannot be edited or deleted after the fact', () => {
  withStore((store) => {
    acme(store);
    updateRecordField(store, {
      record: 'rec-1',
      field: 'renewal',
      value: 'Q3',
      citation: 'note:n-1#L1',
      recordedAt: AT,
    });
    assert.throws(() => store.db.prepare('UPDATE record_fields SET value = ?').run('Q4'), /append-only/);
    assert.throws(() => store.db.prepare('DELETE FROM record_fields').run(), /append-only/);
  });
});

test('a field on a record nobody keeps is refused by the reference, not silently orphaned', () => {
  withStore((store) => {
    assert.throws(() =>
      updateRecordField(store, {
        record: 'rec-nobody',
        field: 'renewal',
        value: 'Q3',
        citation: 'note:n-1#L1',
        recordedAt: AT,
      }),
    );
  });
});
