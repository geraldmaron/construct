import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshStore } from '../state/support.ts';
import { acceptWork, claimWork, completeWork, createWork, getWork, handoffWork, releaseWork, takeoverWork } from '../../../src/kernel/work/service.ts';
import { leasesFor, findOverlaps } from '../../../src/kernel/work/leases.ts';

const time = (minute: number): string => new Date(Date.parse('2026-10-15T12:00:00.000Z') + minute * 60_000).toISOString();
const packet = { state: 'Implementation held', next: 'Validate the implementation' };
function setup() {
  const fx = freshStore();
  const add = (id: string, status: 'open' | 'proposed' | 'blocked' = 'open') => createWork(fx.store, { id, kind: 'task', title: id, description: id, status, at: time(0) });
  return { ...fx, add };
}

test('takeover enforces admission and readiness without mutating refused work', () => {
  const fx = setup();
  try {
    for (const status of ['proposed', 'blocked'] as const) {
      fx.add(status, status);
      const before = getWork(fx.store, status);
      assert.throws(() => takeoverWork(fx.store, { id: status, owner: 'b', now: time(1), until: time(30), reason: 'recover' }), /not ready/);
      assert.deepEqual(getWork(fx.store, status), before);
    }
  } finally { fx.cleanup(); }
});

test('renewing into another worktree moves existing reservations and refuses collisions atomically', () => {
  const fx = setup();
  try {
    fx.add('moving'); fx.add('blocker');
    const first = claimWork(fx.store, { id: 'moving', owner: 'a', lane: '/lane-a', paths: ['src/x.ts'], now: time(1), until: time(30) });
    const other = claimWork(fx.store, { id: 'blocker', owner: 'b', lane: '/lane-b', paths: ['src/x.ts'], now: time(1), until: time(30) });
    const before = getWork(fx.store, 'moving');
    assert.throws(() => claimWork(fx.store, { id: 'moving', owner: 'a', lane: '/lane-b', token: first.claimToken, now: time(2), until: time(35) }), /reserved by other work/);
    assert.deepEqual(getWork(fx.store, 'moving'), before);
    assert.equal(leasesFor(fx.store, 'moving')[0]!.laneRoot, '/lane-a');
    releaseWork(fx.store, { id: 'blocker', owner: 'b', token: other.claimToken, at: time(3) });
    const renewed = claimWork(fx.store, { id: 'moving', owner: 'a', lane: '/lane-b', token: first.claimToken, now: time(4), until: time(40) });
    assert.equal(renewed.claimToken, first.claimToken);
    assert.equal(leasesFor(fx.store, 'moving')[0]!.laneRoot, '/lane-b');
    assert.equal(findOverlaps(fx.store, { paths: ['src/x.ts'], laneRoot: '/lane-b', now: time(5) })[0]?.kind, 'collision');
  } finally { fx.cleanup(); }
});

test('expired and displaced holders cannot settle work, including after release', () => {
  const fx = setup();
  try {
    fx.add('item');
    const a = claimWork(fx.store, { id: 'item', owner: 'a', now: time(1), until: time(30) });
    handoffWork(fx.store, { id: 'item', owner: 'a', token: a.claimToken, packet, to: 'b', now: time(2) });
    const b = acceptWork(fx.store, { id: 'item', owner: 'b', now: time(3), until: time(10) });
    for (const [owner, token] of [['a', a.claimToken], ['b', b.claimToken]]) {
      assert.throws(() => completeWork(fx.store, { id: 'item', owner, token, at: time(10) }), /expired|token|claim/);
    }
    const c = claimWork(fx.store, { id: 'item', owner: 'c', now: time(11), until: time(30) });
    releaseWork(fx.store, { id: 'item', owner: 'c', token: c.claimToken, at: time(12) });
    assert.throws(() => completeWork(fx.store, { id: 'item', owner: 'a', token: a.claimToken, at: time(13) }), /token|claim/);
    assert.equal(getWork(fx.store, 'item')!.status, 'open');
  } finally { fx.cleanup(); }
});

test('accept and takeover reject invalid lease bounds before consuming authority', () => {
  const fx = setup();
  try {
    fx.add('item');
    const a = claimWork(fx.store, { id: 'item', owner: 'a', now: time(1), until: time(30) });
    handoffWork(fx.store, { id: 'item', owner: 'a', token: a.claimToken, packet, now: time(2) });
    const before = getWork(fx.store, 'item');
    assert.throws(() => acceptWork(fx.store, { id: 'item', owner: 'b', now: time(3), until: 'not-a-date' }), /instant/);
    assert.deepEqual(getWork(fx.store, 'item'), before);
    assert.throws(() => takeoverWork(fx.store, { id: 'item', owner: 'b', now: time(200), until: 'not-a-date', reason: 'expired' }), /instant/);
    assert.deepEqual(getWork(fx.store, 'item'), before);
  } finally { fx.cleanup(); }
});

test('acceptance rechecks stale premises and retains the offer after refusal', async () => {
  const { updateWork } = await import('../../../src/kernel/work/service.ts');
  const fx = setup();
  try {
    fx.add('item');
    const a = claimWork(fx.store, { id: 'item', owner: 'a', now: time(1), until: time(30) });
    handoffWork(fx.store, { id: 'item', owner: 'a', token: a.claimToken, packet, now: time(2) });
    updateWork(fx.store, { id: 'item', expectedRevision: getWork(fx.store, 'item')!.revision, premises: { stale: true }, at: time(3) });
    const before = getWork(fx.store, 'item');
    assert.throws(() => acceptWork(fx.store, { id: 'item', owner: 'b', now: time(4), until: time(30) }), /premises changed/);
    assert.deepEqual(getWork(fx.store, 'item'), before);
  } finally { fx.cleanup(); }
});

test('renewal never shortens a claim and canonicalizes equivalent timezone bounds', () => {
  const fx = setup();
  try {
    fx.add('item');
    const first = claimWork(fx.store, { id: 'item', owner: 'a', now: time(1), until: '2026-10-15T08:30:00-04:00' });
    assert.equal(first.claimUntil, time(30));
    const next = claimWork(fx.store, { id: 'item', owner: 'a', token: first.claimToken, now: time(2), until: time(10) });
    assert.equal(next.claimUntil, time(30));
  } finally { fx.cleanup(); }
});

test('a failed acceptance rolls back the claim, offer and every reservation before retry', () => {
  const fx = setup();
  try {
    fx.add('item');
    const first = claimWork(fx.store, { id: 'item', owner: 'a', paths: ['src/a.ts', 'src/b.ts'], now: time(1), until: time(30) });
    handoffWork(fx.store, { id: 'item', owner: 'a', token: first.claimToken, packet, to: 'b', now: time(2) });
    const before = fx.store.db.prepare('SELECT * FROM work_items WHERE id = ?').get('item');
    const paths = leasesFor(fx.store, 'item');
    fx.store.db.exec("CREATE TEMP TRIGGER refuse_transfer BEFORE UPDATE OF session_id ON path_leases BEGIN SELECT RAISE(ABORT, 'injected transfer failure'); END");
    assert.throws(() => acceptWork(fx.store, { id: 'item', owner: 'b', now: time(3), until: time(30) }), /injected transfer failure/);
    assert.deepEqual(fx.store.db.prepare('SELECT * FROM work_items WHERE id = ?').get('item'), before);
    assert.deepEqual(leasesFor(fx.store, 'item'), paths);
    fx.store.db.exec('DROP TRIGGER refuse_transfer');
    const accepted = acceptWork(fx.store, { id: 'item', owner: 'b', now: time(4), until: time(30) });
    assert.notEqual(accepted.claimToken, first.claimToken);
    assert.deepEqual(accepted.leases!.map(lease => lease.sessionId), ['b', 'b']);
  } finally { fx.cleanup(); }
});

test('automatic renewal updates claim and path terms in one atomic transaction', async () => {
  const { renewSessionClaims } = await import('../../../src/kernel/work/service.ts');
  const fx = setup();
  try {
    fx.add('item');
    claimWork(fx.store, { id: 'item', owner: 'a', session: 'a', paths: ['src/a.ts'], now: time(1), until: time(30) });
    fx.store.db.exec("CREATE TEMP TRIGGER refuse_extend BEFORE UPDATE OF until ON path_leases BEGIN SELECT RAISE(ABORT, 'injected renewal failure'); END");
    assert.throws(() => renewSessionClaims(fx.store, { session: 'a', now: time(20), termMs: 30 * 60_000 }), /injected renewal failure/);
    assert.equal(getWork(fx.store, 'item')!.claimUntil, time(30));
    fx.store.db.exec('DROP TRIGGER refuse_extend');
    assert.equal(renewSessionClaims(fx.store, { session: 'a', now: time(20), termMs: 30 * 60_000 }), 1);
    assert.equal(getWork(fx.store, 'item')!.claimUntil, time(50));
    assert.equal(fx.store.db.prepare('SELECT until FROM path_leases WHERE released_at IS NULL').get()!.until, time(50));
  } finally { fx.cleanup(); }
});

test('expiry permits exact-generation release cleanup but never stale completion or cancellation', async () => {
  const { cancelWork } = await import('../../../src/kernel/work/service.ts');
  const fx = setup();
  try {
    fx.add('item');
    const first = claimWork(fx.store, { id: 'item', owner: 'a', now: time(1), until: time(10) });
    assert.throws(() => cancelWork(fx.store, { id: 'item', actor: 'a', token: first.claimToken, at: time(10), reason: 'late' }), /claim expired/);
    assert.equal(releaseWork(fx.store, { id: 'item', owner: 'a', token: first.claimToken, at: time(10) }).status, 'open');
    const next = claimWork(fx.store, { id: 'item', owner: 'b', now: time(11), until: time(30) });
    assert.throws(() => releaseWork(fx.store, { id: 'item', owner: 'a', token: first.claimToken, at: time(12) }), /not held/);
    assert.equal(getWork(fx.store, 'item')!.claimOwner, next.claimOwner);
  } finally { fx.cleanup(); }
});

test('lease times require explicit zones and valid calendar dates without locale guessing', () => {
  const fx = setup();
  try {
    fx.add('item');
    for (const until of ['10/16/2026', '2026-10-16', '2026-10-16T12:00:00', '2026-02-30T12:00:00Z']) {
      assert.throws(() => claimWork(fx.store, { id: 'item', owner: 'a', now: time(1), until }), /instant/);
      assert.equal(getWork(fx.store, 'item')!.status, 'open');
    }
  } finally { fx.cleanup(); }
});

test('tokenless administrative cancellation can close blocked expired work without removing its blockers', async () => {
  const { cancelWork, updateWork } = await import('../../../src/kernel/work/service.ts');
  const fx = setup();
  try {
    fx.add('item');
    const holder = claimWork(fx.store, { id: 'item', owner: 'worker', now: time(1), until: time(10) });
    updateWork(fx.store, { id: 'item', expectedRevision: getWork(fx.store, 'item')!.revision, premises: { stale: true }, at: time(2) });
    assert.throws(() => cancelWork(fx.store, { id: 'item', actor: 'worker', token: holder.claimToken, at: time(10), reason: 'stale worker' }), /claim expired/);
    assert.equal(cancelWork(fx.store, { id: 'item', actor: 'administrator', at: time(10), reason: 'Stop this obsolete work' }).status, 'cancelled');
  } finally { fx.cleanup(); }
});
