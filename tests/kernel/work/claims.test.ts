/**
 * tests/kernel/work/claims.test.ts — a claim is exclusive and fenced.
 *
 * Several sessions share one ledger. A claim is held until it expires; only the
 * token its claim returned can renew or settle it, the same owner included;
 * the token never appears anywhere another session can read; an expired claim
 * frees the item without anyone having to write; and a claim is taken over only
 * from a holder that expired, ended, or went quiet, with the reason recorded.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StateStore } from '../../../src/kernel/state/open.ts';
import { freshStore } from '../state/support.ts';
import { claimWork, completeWork, createWork, exportWork, getWork, listReady, queryWork, renewSessionClaims, restoreWork, takeoverWork } from '../../../src/kernel/work/service.ts';

const T0 = Date.parse('2026-09-24T12:00:00.000Z');
const t = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();

function session(store: StateStore, id: string, lastSeenMinute: number, ended = false): void {
  store.db
    .prepare(`INSERT INTO sessions (id, host, surface, machine, started_at, last_seen_at, ended_at) VALUES (?, 'claude-code', 'interactive', 'test', ?, ?, ?)`)
    .run(id, t(0), t(lastSeenMinute), ended ? t(lastSeenMinute) : null);
}

function item(store: StateStore, id = 'w-1'): void {
  createWork(store, { id, kind: 'task', title: id, description: id, at: t(0), actor: 'test' });
}

test('the same owner cannot re-claim without the token; with it the claim is renewed', () => {
  const fx = freshStore();
  try {
    item(fx.store);
    const first = claimWork(fx.store, { id: 'w-1', owner: 'ses-a/main', session: 'ses-a', until: t(30), now: t(1) });
    assert.throws(() => claimWork(fx.store, { id: 'w-1', owner: 'ses-a/main', session: 'ses-a', until: t(60), now: t(2) }), /already hold/);
    const renewed = claimWork(fx.store, { id: 'w-1', owner: 'ses-a/main', session: 'ses-a', until: t(60), now: t(2), token: first.claimToken });
    assert.equal(renewed.claimToken, first.claimToken);
    assert.equal(renewed.claimUntil, t(60));
    assert.throws(() => claimWork(fx.store, { id: 'w-1', owner: 'ses-b/main', session: 'ses-b', until: t(60), now: t(3) }), /claimed by ses-a\/main/);
  } finally {
    fx.cleanup();
  }
});

test('a live claim is settled only with its token; once it expires it protects nothing', () => {
  const fx = freshStore();
  try {
    item(fx.store, 'w-1');
    item(fx.store, 'w-2');
    const a = claimWork(fx.store, { id: 'w-1', owner: 'ses-a/main', session: 'ses-a', until: t(30), now: t(1) });
    assert.throws(() => completeWork(fx.store, { id: 'w-1', owner: 'ses-b/main', at: t(2) }), /held by ses-a\/main/);
    assert.throws(() => completeWork(fx.store, { id: 'w-1', owner: 'ses-a/main', at: t(2) }), /held by ses-a\/main/, 'the holder too needs its token');
    assert.throws(() => completeWork(fx.store, { id: 'w-1', owner: 'ses-b/main', token: 'guess', at: t(2) }), /does not hold it/);
    assert.equal(completeWork(fx.store, { id: 'w-1', owner: 'ses-a/main', token: a.claimToken, at: t(3) }).status, 'completed');

    claimWork(fx.store, { id: 'w-2', owner: 'ses-a/main', session: 'ses-a', until: t(30), now: t(4) });
    assert.deepEqual(listReady(fx.store, t(10)).map((w) => w.id), [], 'claimed and live: not ready');
    assert.deepEqual(listReady(fx.store, t(31)).map((w) => w.id), ['w-2'], 'expired: ready again, with nothing written');
    const b = claimWork(fx.store, { id: 'w-2', owner: 'ses-b/main', session: 'ses-b', until: t(90), now: t(31) });
    assert.equal(b.claimOwner, 'ses-b/main');
  } finally {
    fx.cleanup();
  }
});

test('the claim token appears only in the claimer’s own result', () => {
  const fx = freshStore();
  try {
    item(fx.store);
    const claimed = claimWork(fx.store, { id: 'w-1', owner: 'ses-a/main', session: 'ses-a', until: t(30), now: t(1) });
    assert.match(claimed.claimToken, /^[0-9a-f-]{36}$/);
    assert.equal(getWork(fx.store, 'w-1')!.claimToken, null);
    assert.equal(queryWork(fx.store, {}).items[0]!.claimToken, null);
    const events = (fx.store.db.prepare('SELECT payload_json FROM work_events').all() as Array<{ payload_json: string }>).map((r) => r.payload_json).join('\n');
    const activity = (fx.store.db.prepare('SELECT payload_json FROM activity_events').all() as Array<{ payload_json: string }>).map((r) => r.payload_json).join('\n');
    assert.doesNotMatch(events, new RegExp(claimed.claimToken));
    assert.doesNotMatch(activity, new RegExp(claimed.claimToken));
  } finally {
    fx.cleanup();
  }
});

test('a claim is taken over only from a holder that ended or went quiet, and the reason is kept', () => {
  const fx = freshStore();
  try {
    item(fx.store);
    session(fx.store, 'ses-a', 50);
    claimWork(fx.store, { id: 'w-1', owner: 'ses-a/main', session: 'ses-a', until: t(300), now: t(40) });
    assert.throws(() => takeoverWork(fx.store, { id: 'w-1', owner: 'ses-b/main', session: 'ses-b', until: t(400), now: t(60), reason: 'looks stuck' }), /still active/);
    const quiet = takeoverWork(fx.store, { id: 'w-1', owner: 'ses-b/main', session: 'ses-b', until: t(400), now: t(50 + 121), reason: 'ses-a silent for two hours' });
    assert.equal(quiet.claimOwner, 'ses-b/main');
    const event = fx.store.db.prepare(`SELECT payload_json FROM work_events WHERE kind = 'taken_over'`).get() as { payload_json: string };
    assert.match(event.payload_json, /ses-a silent for two hours/);

    item(fx.store, 'w-2');
    session(fx.store, 'ses-c', 200, true);
    claimWork(fx.store, { id: 'w-2', owner: 'ses-c/main', session: 'ses-c', until: t(500), now: t(199) });
    assert.equal(takeoverWork(fx.store, { id: 'w-2', owner: 'ses-b/main', session: 'ses-b', until: t(600), now: t(201), reason: 'ses-c ended' }).claimOwner, 'ses-b/main');
  } finally {
    fx.cleanup();
  }
});

test('a holder that keeps calling keeps its claims: renewal extends claims past half their term', () => {
  const fx = freshStore();
  try {
    item(fx.store, 'w-1');
    item(fx.store, 'w-2');
    claimWork(fx.store, { id: 'w-1', owner: 'ses-a/main', session: 'ses-a', until: t(30), now: t(0) });
    claimWork(fx.store, { id: 'w-2', owner: 'ses-a/main', session: 'ses-a', until: t(60), now: t(0) });
    assert.equal(renewSessionClaims(fx.store, { session: 'ses-a', now: t(20), termMs: 30 * 60_000 }), 1);
    assert.equal(getWork(fx.store, 'w-1')!.claimUntil, t(50));
    assert.equal(getWork(fx.store, 'w-2')!.claimUntil, t(60));
    assert.equal(renewSessionClaims(fx.store, { session: 'ses-b', now: t(20), termMs: 30 * 60_000 }), 0);
  } finally {
    fx.cleanup();
  }
});

test('a snapshot never carries a live claim’s secret, and one from another project is refused', () => {
  const fx = freshStore();
  const other = freshStore();
  try {
    item(fx.store);
    const claimed = claimWork(fx.store, { id: 'w-1', owner: 'ses-a/main', session: 'ses-a', until: t(30), now: t(1) });
    const dump = exportWork(fx.store, t(2), 'proj-a');
    assert.doesNotMatch(JSON.stringify(dump), new RegExp(claimed.claimToken));
    assert.throws(() => restoreWork(other.store, dump, t(3), 'proj-b'), /taken from project proj-a/);
    assert.equal(restoreWork(other.store, dump, t(3), 'proj-a').imported, 1);
  } finally {
    fx.cleanup();
    other.cleanup();
  }
});
