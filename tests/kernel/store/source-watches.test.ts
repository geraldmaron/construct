/**
 * tests/kernel/store/source-watches.test.ts — the source-watch substrate.
 *
 * The properties mirror standing.test.ts on purpose: dueness is computed from
 * the record, never from a resident process; a firing is lineage and cannot
 * be edited or deleted; a retired watch stops coming due but keeps its
 * history. What is particular to a source watch: it cannot be declared over
 * a source that does not exist or was retired, and only one active watch may
 * stand over a given source at a time.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import { addSource, retireSource } from '../../../src/kernel/store/sources.ts';
import {
  declareSourceWatch,
  dueSourceWatches,
  firingsForSourceWatch,
  getSourceWatch,
  latestSourceWatchFiring,
  listSourceWatches,
  recordSourceWatchFiring,
  retireSourceWatch,
} from '../../../src/kernel/store/source-watches.ts';

const AT = '2026-08-21T00:00:00.000Z';
const ONE_MIN_LESS = '2026-08-21T00:00:59.000Z';
const ONE_MIN_ON = '2026-08-21T00:01:00.000Z';
const LATER = '2026-08-21T01:00:00.000Z';

function withStore<T>(fn: (store: ReturnType<typeof openStore>) => T): T {
  const fixture = sterile();
  const store = openStore(join(fixture.paths.dataDir, 'construct.db'));
  try {
    return fn(store);
  } finally {
    store.close();
    fixture.cleanup();
  }
}

function declareSource(store: ReturnType<typeof openStore>, id = 'src-1'): void {
  addSource(store, { id, workspace: 'ops', kind: 'directory', locator: '/repo/docs', addedAt: AT });
}

const WATCH = {
  id: 'w-1',
  workspace: 'ops',
  source: 'src-1',
  host: null,
  everyMinutes: 1,
  declaredAt: AT,
};

test('a declared source watch is listed, and never having fired means due now', () => {
  withStore((store) => {
    declareSource(store);
    declareSourceWatch(store, WATCH);
    assert.equal(listSourceWatches(store).length, 1);
    assert.equal(getSourceWatch(store, 'w-1')?.source, 'src-1');
    assert.deepEqual(dueSourceWatches(store, AT).map((w) => w.id), ['w-1']);
  });
});

test('dueness is the cadence against the last firing, nothing else', () => {
  withStore((store) => {
    declareSource(store);
    declareSourceWatch(store, WATCH);
    recordSourceWatchFiring(store, { watch: 'w-1', run: 'watch-w-1', firedAt: AT, snapshot: { outcome: 'listed', total: 0, documents: [] } });

    assert.deepEqual(dueSourceWatches(store, ONE_MIN_LESS), [], 'the cadence has not elapsed');
    assert.deepEqual(dueSourceWatches(store, ONE_MIN_ON).map((w) => w.id), ['w-1']);
    assert.equal(latestSourceWatchFiring(store, 'w-1')?.firedAt, AT);
  });
});

test('a retired source watch stops coming due and keeps its firings', () => {
  withStore((store) => {
    declareSource(store);
    declareSourceWatch(store, WATCH);
    recordSourceWatchFiring(store, { watch: 'w-1', run: 'watch-w-1', firedAt: AT, snapshot: { outcome: 'listed', total: 0, documents: [] } });
    retireSourceWatch(store, 'w-1', ONE_MIN_LESS);

    assert.deepEqual(dueSourceWatches(store, ONE_MIN_ON), []);
    assert.equal(listSourceWatches(store).length, 0, 'retired is out of the active list');
    assert.equal(listSourceWatches(store, { includeRetired: true }).length, 1);
    assert.equal(firingsForSourceWatch(store, 'w-1').length, 1, 'history survives retirement');

    assert.throws(() => retireSourceWatch(store, 'w-1', ONE_MIN_ON), /already retired/);
  });
});

test('firings are append-only under the database, not caller discipline', () => {
  withStore((store) => {
    declareSource(store);
    declareSourceWatch(store, WATCH);
    recordSourceWatchFiring(store, { watch: 'w-1', run: 'watch-w-1', firedAt: AT, snapshot: { outcome: 'listed', total: 0, documents: [] } });
    assert.throws(() => store.db.prepare('DELETE FROM source_watch_firings').run(), /append-only/);
    assert.throws(
      () => store.db.prepare("UPDATE source_watch_firings SET run = 'run-2'").run(),
      /append-only/,
    );
  });
});

test('the most recent firing wins, and firings read oldest first', () => {
  withStore((store) => {
    declareSource(store);
    declareSourceWatch(store, WATCH);
    recordSourceWatchFiring(store, {
      watch: 'w-1',
      run: 'watch-w-1',
      firedAt: AT,
      snapshot: { outcome: 'listed', total: 1, documents: [{ path: 'a.md', bytes: 10, binary: false }] },
    });
    recordSourceWatchFiring(store, {
      watch: 'w-1',
      run: 'watch-w-1',
      firedAt: LATER,
      snapshot: { outcome: 'listed', total: 2, documents: [] },
    });

    const ordered = firingsForSourceWatch(store, 'w-1');
    assert.deepEqual(ordered.map((f) => f.firedAt), [AT, LATER]);

    const latest = latestSourceWatchFiring(store, 'w-1');
    assert.equal(latest?.firedAt, LATER);
    assert.deepEqual(latest?.snapshot, { outcome: 'listed', total: 2, documents: [] });
  });
});

test('a watch cannot be declared over a source that does not exist or was retired', () => {
  withStore((store) => {
    assert.throws(
      () => declareSourceWatch(store, { ...WATCH, source: 'ghost' }),
      /no source ghost/,
    );
    declareSource(store);
    retireSource(store, 'src-1', AT);
    assert.throws(() => declareSourceWatch(store, WATCH), /was retired/);
  });
});

test('only one active watch may stand over a given source at a time', () => {
  withStore((store) => {
    declareSource(store);
    declareSourceWatch(store, WATCH);
    assert.throws(() => declareSourceWatch(store, { ...WATCH, id: 'w-2' }));
    retireSourceWatch(store, 'w-1', AT);
    // Retiring frees the source for a fresh declaration.
    declareSourceWatch(store, { ...WATCH, id: 'w-3', declaredAt: LATER });
    assert.equal(listSourceWatches(store).length, 1);
  });
});

test('a broken cadence and an unknown watch are refused at the door', () => {
  withStore((store) => {
    declareSource(store);
    assert.throws(() => declareSourceWatch(store, { ...WATCH, everyMinutes: 0 }), /positive whole number/);
    assert.throws(() => declareSourceWatch(store, { ...WATCH, workspace: '  ' }), /names no workspace/);
    assert.throws(
      () => recordSourceWatchFiring(store, { watch: 'w-none', run: 'r', firedAt: AT, snapshot: null }),
      /no source watch w-none/,
    );
    assert.throws(() => retireSourceWatch(store, 'w-none', AT), /no source watch/);
  });
});

test('a snapshot round-trips through storage exactly, opaque to this module', () => {
  withStore((store) => {
    declareSource(store);
    declareSourceWatch(store, WATCH);
    const snapshot = {
      outcome: 'listed' as const,
      total: 3,
      documents: [
        { path: 'a.md', bytes: 12, binary: false },
        { path: 'b.pdf', bytes: 900, binary: true },
      ],
    };
    recordSourceWatchFiring(store, { watch: 'w-1', run: 'watch-w-1', firedAt: AT, snapshot });
    assert.deepEqual(latestSourceWatchFiring(store, 'w-1')?.snapshot, snapshot);
  });
});
