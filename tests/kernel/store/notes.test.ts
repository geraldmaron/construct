/**
 * tests/kernel/store/notes.test.ts — the notes store.
 *
 * The properties held here are what citations depend on: a note is
 * append-only at the trigger level, an empty or workspaceless note cannot
 * enter, both doors land in the same shape, and a citation resolves to the
 * exact line it names — or to nothing, with no fuzzy nearest-line rescue.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import {
  getNote,
  noteCitation,
  notesFor,
  parseNoteCitation,
  recordNote,
  resolveNoteCitation,
} from '../../../src/kernel/store/notes.ts';

const AT = '2026-08-05T00:00:00.000Z';

function withStore<T>(fn: (store: ReturnType<typeof openStore>) => T): T {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    return fn(store);
  } finally {
    store.close();
    fixture.cleanup();
  }
}

test('a note enters through either door and reads back the same shape', () => {
  withStore((store) => {
    recordNote(store, {
      id: 'n-1',
      workspace: 'acme',
      run: 'run-1',
      door: 'file-drop',
      body: 'call went long\nthey want the pilot in Q4',
      recordedAt: AT,
    });
    recordNote(store, {
      id: 'n-2',
      workspace: 'acme',
      run: null,
      door: 'host-session',
      body: 'follow up with legal',
      recordedAt: AT,
    });
    assert.equal(getNote(store, 'n-1')?.door, 'file-drop');
    assert.equal(getNote(store, 'n-2')?.door, 'host-session');
    assert.equal(notesFor(store, 'acme').length, 2);
    assert.equal(notesFor(store, 'other').length, 0);
  });
});

test('an empty body, a blank workspace, and an unknown door are refused', () => {
  withStore((store) => {
    const base = { id: 'n-1', workspace: 'acme', run: null, recordedAt: AT } as const;
    assert.throws(
      () => recordNote(store, { ...base, door: 'file-drop', body: '   ' }),
      /has no body/,
    );
    assert.throws(
      () => recordNote(store, { ...base, workspace: ' ', door: 'file-drop', body: 'x' }),
      /has no workspace/,
    );
    assert.throws(
      () => recordNote(store, { ...base, door: 'email' as never, body: 'x' }),
      /unknown door/,
    );
  });
});

test('a note is never edited or deleted: the triggers refuse, not the callers', () => {
  withStore((store) => {
    recordNote(store, {
      id: 'n-1',
      workspace: 'acme',
      run: null,
      door: 'file-drop',
      body: 'original words',
      recordedAt: AT,
    });
    assert.throws(
      () => store.db.prepare('UPDATE notes SET body = ? WHERE id = ?').run('revised words', 'n-1'),
      /never edited/,
    );
    assert.throws(
      () => store.db.prepare('DELETE FROM notes WHERE id = ?').run('n-1'),
      /never deleted/,
    );
  });
});

test('a citation resolves to the exact line it names, and to nothing otherwise', () => {
  withStore((store) => {
    recordNote(store, {
      id: 'n-1',
      workspace: 'acme',
      run: null,
      door: 'file-drop',
      body: 'line one\nline two\nline three',
      recordedAt: AT,
    });
    const hit = resolveNoteCitation(store, noteCitation('n-1', 2));
    assert.equal(hit?.text, 'line two');
    assert.equal(hit?.line, 2);
    assert.equal(resolveNoteCitation(store, 'note:n-1#L4'), null);
    assert.equal(resolveNoteCitation(store, 'note:missing#L1'), null);
    assert.equal(resolveNoteCitation(store, 'lesson:n-1'), null);
  });
});

test('citation parsing round-trips and rejects malformed or zero-line forms', () => {
  assert.deepEqual(parseNoteCitation(noteCitation('n-9', 7)), { note: 'n-9', line: 7 });
  assert.equal(parseNoteCitation('note:n-9#L0'), null);
  assert.equal(parseNoteCitation('note:n-9'), null);
  assert.equal(parseNoteCitation('n-9#L1'), null);
});
