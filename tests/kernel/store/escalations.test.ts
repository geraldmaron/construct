/**
 * tests/kernel/store/escalations.test.ts — the store-backed escalation cache
 * (construct-2fu).
 *
 * The cache exists so a model call is paid once per outcome across processes,
 * and it is write-once so the reason an escalated implication cites cannot be
 * quietly replaced afterwards. Both are properties of the store rather than of
 * caller discipline, which is what these tests hold it to.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import {
  readEscalation,
  storeEscalationCache,
  writeEscalation,
} from '../../../src/kernel/store/escalations.ts';
import type { Implication } from '../../../src/kernel/implication/map.ts';

const AT = '2026-08-04T00:00:00.000Z';
const OUTCOME = 'a customer cannot use our checkout with her voice software';

const NAMED: readonly Implication[] = [
  {
    domain: 'accessibility',
    concern: 'whether people with disabilities can actually use it',
    score: 0,
    signals: ['the outcome describes assistive software'],
  },
];

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

test('what a host said for an outcome is read back with its provenance', () => {
  withStore((store) => {
    assert.equal(writeEscalation(store, {
      outcome: OUTCOME,
      implications: NAMED,
      host: 'opencode',
      recordedAt: AT,
    }), true);

    const found = readEscalation(store, OUTCOME);
    assert.ok(found);
    assert.deepEqual(found.implications, NAMED);
    assert.equal(found.host, 'opencode');
    assert.equal(found.recordedAt, AT);
  });
});

test('an outcome nobody escalated is a miss, not an empty answer', () => {
  withStore((store) => {
    assert.equal(readEscalation(store, 'never asked'), undefined);
    assert.equal(storeEscalationCache(store, { host: 'x', at: AT }).get('never asked'), undefined);
  });
});

test('a cached miss is cached, so the expensive failure is not re-paid every run', () => {
  withStore((store) => {
    const cache = storeEscalationCache(store, { host: 'opencode', at: AT });
    cache.set(OUTCOME, []);
    const found = cache.get(OUTCOME);
    assert.ok(found, 'an empty result must be a hit, not a miss');
    assert.deepEqual(found, []);
  });
});

test('the first answer stands: a second escalation does not overwrite the cited reason', () => {
  withStore((store) => {
    writeEscalation(store, { outcome: OUTCOME, implications: NAMED, host: 'opencode', recordedAt: AT });
    const second = writeEscalation(store, {
      outcome: OUTCOME,
      implications: [],
      host: 'claude',
      recordedAt: '2026-08-05T00:00:00.000Z',
    });
    assert.equal(second, false, 'a repeat write reports that it changed nothing');
    const found = readEscalation(store, OUTCOME);
    assert.deepEqual(found?.implications, NAMED);
    assert.equal(found?.host, 'opencode');
  });
});

test('the write-once rule is the store\'s, not the caller\'s', () => {
  withStore((store) => {
    writeEscalation(store, { outcome: OUTCOME, implications: NAMED, host: 'opencode', recordedAt: AT });
    assert.throws(
      () =>
        store.db
          .prepare('UPDATE escalation_cache SET implications = ? WHERE outcome = ?')
          .run('[]', OUTCOME),
      /write-once/,
      'reaching past the module must not rewrite a model\'s stated reason',
    );
  });
});

test('a corrupt row costs one re-escalation rather than failing the run', () => {
  withStore((store) => {
    store.db
      .prepare('INSERT INTO escalation_cache (outcome, implications, host, recorded_at) VALUES (?, ?, ?, ?)')
      .run(OUTCOME, 'not json at all', 'opencode', AT);
    assert.equal(readEscalation(store, OUTCOME), undefined);
  });
});

test('the cache survives a process boundary, which is the only place it matters', () => {
  const fixture = sterile();
  const path = join(fixture.root, 'data', 'construct.db');
  try {
    const first = openStore(path);
    storeEscalationCache(first, { host: 'opencode', at: AT }).set(OUTCOME, NAMED);
    first.close();

    // A second open is what a second CLI invocation actually does.
    const second = openStore(path);
    assert.deepEqual(
      storeEscalationCache(second, { host: 'opencode', at: AT }).get(OUTCOME),
      NAMED,
    );
    second.close();
  } finally {
    fixture.cleanup();
  }
});
