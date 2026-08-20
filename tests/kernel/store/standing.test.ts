/**
 * tests/kernel/store/standing.test.ts — the standing-outcome substrate.
 *
 * The properties: dueness is computed from the record, never from a resident
 * process; a firing is lineage and cannot be edited or deleted; a retired
 * intention stops coming due but keeps its history; and a declaration that
 * states nothing is refused at the door rather than firing forever.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import {
  declareStanding,
  dueStanding,
  firingsFor,
  getStanding,
  lastFiredAt,
  listStanding,
  recordFiring,
  retireStanding,
} from '../../../src/kernel/store/standing.ts';

const AT = '2026-08-03T00:00:00.000Z';
const ONE_HOUR_LESS = '2026-08-03T00:59:00.000Z';
const ONE_HOUR_ON = '2026-08-03T01:00:00.000Z';

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

const WEEKLY = {
  id: 's-1',
  workspace: 'ops',
  outcome: 'Review the week for commitments that no longer agree',
  domains: null,
  everyMinutes: 60,
  declaredAt: AT,
};

test('a declared standing outcome is listed, and never having fired means due now', () => {
  withStore((store) => {
    declareStanding(store, WEEKLY);
    assert.equal(listStanding(store).length, 1);
    assert.equal(getStanding(store, 's-1')?.outcome, WEEKLY.outcome);
    // An intention that has never run is exactly what the first firing is for.
    assert.deepEqual(dueStanding(store, AT).map((s) => s.id), ['s-1']);
  });
});

test('dueness is the cadence against the last firing, nothing else', () => {
  withStore((store) => {
    declareStanding(store, WEEKLY);
    recordFiring(store, { standing: 's-1', run: 'run-1', firedAt: AT });

    assert.deepEqual(dueStanding(store, ONE_HOUR_LESS), [], 'the cadence has not elapsed');
    assert.deepEqual(dueStanding(store, ONE_HOUR_ON).map((s) => s.id), ['s-1']);
    assert.equal(lastFiredAt(store, 's-1'), AT);
  });
});

test('a retired standing outcome stops coming due and keeps its firings', () => {
  withStore((store) => {
    declareStanding(store, WEEKLY);
    recordFiring(store, { standing: 's-1', run: 'run-1', firedAt: AT });
    retireStanding(store, 's-1', ONE_HOUR_LESS);

    assert.deepEqual(dueStanding(store, ONE_HOUR_ON), []);
    assert.equal(listStanding(store).length, 0, 'retired is out of the active list');
    assert.equal(listStanding(store, { includeRetired: true }).length, 1);
    assert.equal(firingsFor(store, 's-1').length, 1, 'history survives retirement');

    assert.throws(() => retireStanding(store, 's-1', ONE_HOUR_ON), /already retired/);
  });
});

test('firings are append-only under the database, not caller discipline', () => {
  withStore((store) => {
    declareStanding(store, WEEKLY);
    recordFiring(store, { standing: 's-1', run: 'run-1', firedAt: AT });
    assert.throws(() => store.db.prepare('DELETE FROM standing_runs').run(), /append-only/);
    assert.throws(
      () => store.db.prepare("UPDATE standing_runs SET run = 'run-2'").run(),
      /append-only/,
    );
  });
});

test('an empty intention, a broken cadence, and an unknown standing are refused at the door', () => {
  withStore((store) => {
    assert.throws(() => declareStanding(store, { ...WEEKLY, outcome: '  ' }), /states no outcome/);
    assert.throws(() => declareStanding(store, { ...WEEKLY, everyMinutes: 0 }), /positive whole number/);
    assert.throws(() => declareStanding(store, { ...WEEKLY, domains: [] }), /empty staff/);
    assert.throws(
      () => recordFiring(store, { standing: 's-none', run: 'r', firedAt: AT }),
      /no standing outcome s-none/,
    );
    assert.throws(() => retireStanding(store, 's-none', AT), /no standing outcome/);
  });
});
