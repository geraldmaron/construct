/**
 * tests/kernel/run/stale-drafts.test.ts — `staleUnreviewedDrafts` names a
 * settled deliverable that has sat at `draft` past the threshold, and only
 * that: a task that never settled, one that failed instead of producing a
 * deliverable, and one a verdict already moved past draft are all silent no
 * matter how old they are. The threshold itself is a boundary a caller
 * chooses, so this file proves the boundary is exact rather than trusting
 * the default.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import type { Store } from '../../../src/kernel/store/open.ts';
import { claimTask, completeTask, enqueueTask, failTask } from '../../../src/kernel/store/tasks.ts';
import {
  DEFAULT_STALE_DRAFT_THRESHOLD_MS,
  promotionOf,
  recordVerdict,
  staleUnreviewedDrafts,
} from '../../../src/kernel/run/promotion.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';

const NOW = '2026-08-10T00:00:00.000Z';
const EARLY = '2026-07-01T00:00:00.000Z';
const THRESHOLD = DEFAULT_STALE_DRAFT_THRESHOLD_MS;
const DAY_MS = 24 * 60 * 60 * 1000;

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

function brief(role: string, challenges: readonly string[] = []): Brief {
  return {
    id: `t-${role}`,
    outcome: 'ship the thing',
    role,
    inputs: [],
    capabilities: [],
    postconditions: [],
    challenges,
  };
}

/** Enqueue a task and settle it as `done` with a caller-chosen settledAt. */
function settle(
  store: Store,
  opts: {
    readonly id: string;
    readonly run: string;
    readonly role: string;
    readonly brief: Brief;
    readonly settledAt: string;
  },
): void {
  enqueueTask(store, { id: opts.id, run: opts.run, role: opts.role, brief: opts.brief, at: EARLY });
  const leased = claimTask(store, {
    owner: 'test',
    leaseUntil: '2099-01-01T00:00:00.000Z',
    now: EARLY,
    run: opts.run,
  });
  assert.ok(leased, `expected to claim ${opts.id} right after enqueuing it`);
  completeTask(store, {
    id: opts.id,
    owner: 'test',
    token: leased.token,
    result: { text: 'a deliverable' },
    spend: 0,
    spendReported: false,
    at: opts.settledAt,
  });
}

function ago(ms: number): string {
  return new Date(Date.parse(NOW) - ms).toISOString();
}

test('nothing is reported when nothing has settled', () => {
  withStore((store) => {
    assert.deepEqual(staleUnreviewedDrafts(store, { now: NOW, thresholdMs: THRESHOLD }), []);
  });
});

test('a task that never settled is not reported, however old its enqueue time', () => {
  withStore((store) => {
    enqueueTask(store, { id: 't-pending', run: 'run-p', role: 'writer', brief: brief('writer'), at: EARLY });
    assert.deepEqual(staleUnreviewedDrafts(store, { now: NOW, thresholdMs: THRESHOLD }), []);
  });
});

test('a failed task is not reported — there is no deliverable to review', () => {
  withStore((store) => {
    enqueueTask(store, { id: 't-failed', run: 'run-f', role: 'writer', brief: brief('writer'), at: EARLY });
    const leased = claimTask(store, {
      owner: 'test',
      leaseUntil: '2099-01-01T00:00:00.000Z',
      now: EARLY,
      run: 'run-f',
    });
    assert.ok(leased);
    failTask(store, {
      id: 't-failed',
      owner: 'test',
      token: leased.token,
      error: { message: 'it broke' },
      at: ago(30 * DAY_MS),
    });

    assert.deepEqual(staleUnreviewedDrafts(store, { now: NOW, thresholdMs: THRESHOLD }), []);
  });
});

test('a settled deliverable just under the threshold is not stale; just over, it is', () => {
  withStore((store) => {
    settle(store, {
      id: 't-under',
      run: 'run-under',
      role: 'writer',
      brief: brief('writer'),
      settledAt: ago(THRESHOLD - 1000),
    });
    settle(store, {
      id: 't-over',
      run: 'run-over',
      role: 'writer',
      brief: brief('writer'),
      settledAt: ago(THRESHOLD + 1000),
    });

    const stale = staleUnreviewedDrafts(store, { now: NOW, thresholdMs: THRESHOLD });
    assert.equal(stale.length, 1, 'only the task past the threshold is reported');
    assert.equal(stale[0].task, 't-over');
    assert.equal(stale[0].run, 'run-over');
    assert.ok(stale[0].ageMs > THRESHOLD);
  });
});

test('multiple stale drafts are reported oldest first, and the count matches', () => {
  withStore((store) => {
    settle(store, {
      id: 't-recent',
      run: 'run-recent',
      role: 'writer',
      brief: brief('writer'),
      settledAt: ago(THRESHOLD + 1000),
    });
    settle(store, {
      id: 't-ancient',
      run: 'run-ancient',
      role: 'writer',
      brief: brief('writer'),
      settledAt: ago(THRESHOLD + 5 * DAY_MS),
    });

    const stale = staleUnreviewedDrafts(store, { now: NOW, thresholdMs: THRESHOLD });
    assert.equal(stale.length, 2);
    assert.equal(stale[0].task, 't-ancient', 'the oldest settlement sorts first');
    assert.equal(stale[1].task, 't-recent');
    assert.ok(stale[0].ageMs > stale[1].ageMs);
  });
});

test('a verdict that moved a deliverable past draft clears it, no matter its age', () => {
  withStore((store) => {
    const settledAt = ago(30 * DAY_MS);
    settle(store, {
      id: 't-reviewed',
      run: 'run-reviewed',
      role: 'writer',
      brief: brief('writer', ['only-challenge']),
      settledAt,
    });

    recordVerdict(store, {
      task: 't-reviewed',
      challenge: 'only-challenge',
      outcome: 'passed',
      by: 'reviewer',
      at: settledAt,
    });

    assert.equal(promotionOf(store, 't-reviewed')?.state, 'final', 'sanity: the verdict did promote it');
    assert.deepEqual(staleUnreviewedDrafts(store, { now: NOW, thresholdMs: THRESHOLD }), []);
  });
});
