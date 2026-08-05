/**
 * tests/kernel/store/dispatch.test.ts — the dispatch surface a run was filed
 * with.
 *
 * Held as store properties: the record survives a reopen, a run filed without
 * one reads back as null rather than something invented, and the record is
 * write-once — the host and model named at the moment of intent are facts, and
 * a fact that can be quietly replaced is how a later dispatch gets re-aimed
 * with no trace.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import { readRunDispatch, recordRunDispatch } from '../../../src/kernel/store/dispatch.ts';

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

test('the surface a run was filed with reads back whole', () => {
  withStore((store) => {
    recordRunDispatch(store, {
      run: 'run-1',
      host: 'opencode',
      model: 'openrouter/qwen/qwen3-30b-a3b-instruct-2507',
      recordedAt: AT,
    });
    const found = readRunDispatch(store, 'run-1');
    assert.ok(found);
    assert.equal(found.host, 'opencode');
    assert.equal(found.model, 'openrouter/qwen/qwen3-30b-a3b-instruct-2507');
    assert.equal(found.binary, null);
    assert.equal(found.dir, null);
    assert.equal(found.recordedAt, AT);
  });
});

test('a run filed with no named host has no record, not an invented one', () => {
  withStore((store) => {
    assert.equal(readRunDispatch(store, 'run-none'), null);
  });
});

test('the record is write-once: re-aiming a run is not an edit anyone can make', () => {
  withStore((store) => {
    recordRunDispatch(store, { run: 'run-1', host: 'opencode', recordedAt: AT });
    assert.throws(() =>
      store.db.prepare("UPDATE run_dispatch SET model = 'something-else' WHERE run = ?").run('run-1'),
    );
    assert.throws(() =>
      recordRunDispatch(store, { run: 'run-1', host: 'claude', recordedAt: AT }),
    );
  });
});
