/**
 * tests/kernel/work/handoff.test.ts — handing claimed work to the next holder.
 *
 * Only the holder, with its token, offers a handoff. The claim stays its
 * holder's until someone accepts; accepting moves the claim, a new token, and
 * the reservations in one transaction, and the offerer's token stops working.
 * An offer made to someone is theirs alone. An offer that lapses with its
 * claim leaves the packet for whoever claims next. The packet is bounded and
 * screened for credentials when written, and a handoff never moves approvals.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StateStore } from '../../../src/kernel/state/open.ts';
import { freshStore } from '../state/support.ts';
import { acceptWork, claimWork, completeWork, createWork, handoffOf, handoffWork, listOffers, releaseWork, HANDOFF_HOLD_MS } from '../../../src/kernel/work/service.ts';
import { HandoffPacketError, normalizePacket } from '../../../src/kernel/work/handoff.ts';
import { leasesFor } from '../../../src/kernel/work/leases.ts';

const T0 = Date.parse('2026-09-24T12:00:00.000Z');
const t = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();
const PACKET = { state: 'parser half done; lexer untouched', next: 'finish src/parser/expr.ts', watchOut: ['the old grammar test is flaky'], where: { branch: 'feat/parser', commit: 'A1B2C3D', paths: ['src/parser/'] } };

function item(store: StateStore, id = 'w-1'): void {
  createWork(store, { id, kind: 'task', title: id, description: id, at: t(0), actor: 'test' });
}

test('the holder offers with its token; the acceptor gets the claim, a new token, and the reservations; the old token is dead', () => {
  const fx = freshStore();
  try {
    item(fx.store);
    const a = claimWork(fx.store, { id: 'w-1', owner: 'ses-a/main', session: 'ses-a', until: t(30), now: t(1), paths: ['src/parser/'] });
    assert.throws(() => handoffWork(fx.store, { id: 'w-1', owner: 'ses-a/main', token: 'guess', packet: PACKET, now: t(2) }), /only its holder hands it off/);
    assert.throws(() => handoffWork(fx.store, { id: 'w-1', owner: 'ses-b/main', token: a.claimToken, packet: PACKET, now: t(2) }), /only its holder hands it off/);
    assert.throws(() => handoffWork(fx.store, { id: 'w-1', owner: 'ses-a/main', token: a.claimToken, packet: PACKET, to: 'ses-a/main', now: t(2) }), /someone else/);

    const offered = handoffWork(fx.store, { id: 'w-1', owner: 'ses-a/main', token: a.claimToken, packet: PACKET, now: t(2) });
    assert.equal(offered.claimOwner, 'ses-a/main', 'still the holder’s until accepted');
    assert.equal(offered.claimUntil, new Date(Date.parse(t(2)) + HANDOFF_HOLD_MS).toISOString(), 'held long enough to be accepted');
    assert.equal(offered.handoff.packet.where.commit, 'a1b2c3d');
    assert.deepEqual(listOffers(fx.store, t(3)).map((o) => o.work.id), ['w-1']);
    assert.deepEqual(listOffers(fx.store, t(3), { owner: 'ses-a/main', session: 'ses-a' }), [], 'not an offer to its own offerer');
    assert.throws(() => acceptWork(fx.store, { id: 'w-1', owner: 'ses-a/main', session: 'ses-a', until: t(60), now: t(3) }), /you offered/);

    const b = acceptWork(fx.store, { id: 'w-1', owner: 'ses-b/main', session: 'ses-b', agent: 'main', lane: '/lanes/b', branch: 'feat/parser', until: t(60), now: t(4) });
    assert.equal(b.claimOwner, 'ses-b/main');
    assert.notEqual(b.claimToken, a.claimToken);
    assert.deepEqual([b.handoff.takenBy, b.handoff.takenVia, b.handoff.packet.next], ['ses-b/main', 'accept', 'finish src/parser/expr.ts']);
    assert.deepEqual(leasesFor(fx.store, 'w-1').map((l) => [l.path, l.sessionId, l.laneRoot, l.branch]), [['src/parser/', 'ses-b', '/lanes/b', 'feat/parser']]);
    assert.throws(() => completeWork(fx.store, { id: 'w-1', owner: 'ses-a/main', token: a.claimToken, at: t(5) }), /held by ses-b\/main|do not hold/);
    assert.throws(() => acceptWork(fx.store, { id: 'w-1', owner: 'ses-c/main', session: 'ses-c', until: t(60), now: t(5) }), /no open handoff/, 'accepted once');
    assert.equal(listOffers(fx.store, t(5)).length, 0);
    assert.equal(completeWork(fx.store, { id: 'w-1', owner: 'ses-b/main', token: b.claimToken, at: t(6) }).status, 'completed');
    const events = fx.store.db.prepare(`SELECT kind, actor FROM work_events WHERE work_id = 'w-1' AND kind LIKE 'handoff%' ORDER BY id`).all() as { kind: string; actor: string }[];
    assert.deepEqual(events.map((e) => [e.kind, e.actor]), [['handoff_offered', 'ses-a/main'], ['handoff_accepted', 'ses-b/main']]);
  } finally {
    fx.cleanup();
  }
});

test('an offer to someone is theirs alone: a claimant or a whole session', () => {
  const fx = freshStore();
  try {
    item(fx.store, 'w-1');
    item(fx.store, 'w-2');
    const a1 = claimWork(fx.store, { id: 'w-1', owner: 'ses-a/main', session: 'ses-a', until: t(30), now: t(1) });
    const a2 = claimWork(fx.store, { id: 'w-2', owner: 'ses-a/main', session: 'ses-a', until: t(30), now: t(1) });
    handoffWork(fx.store, { id: 'w-1', owner: 'ses-a/main', token: a1.claimToken, packet: PACKET, to: 'ses-b/reviewer', now: t(2) });
    handoffWork(fx.store, { id: 'w-2', owner: 'ses-a/main', token: a2.claimToken, packet: PACKET, to: 'ses-b', now: t(2) });
    assert.deepEqual(listOffers(fx.store, t(3), { owner: 'ses-c/main', session: 'ses-c' }), []);
    assert.deepEqual(listOffers(fx.store, t(3), { owner: 'ses-b/main', session: 'ses-b' }).map((o) => o.work.id), ['w-2']);
    assert.deepEqual(listOffers(fx.store, t(3), { owner: 'ses-b/reviewer', session: 'ses-b' }).map((o) => o.work.id), ['w-1', 'w-2']);
    assert.throws(() => acceptWork(fx.store, { id: 'w-1', owner: 'ses-c/main', session: 'ses-c', until: t(60), now: t(4) }), /offered to ses-b\/reviewer/);
    assert.throws(() => acceptWork(fx.store, { id: 'w-1', owner: 'ses-b/main', session: 'ses-b', until: t(60), now: t(4) }), /offered to ses-b\/reviewer/);
    assert.equal(acceptWork(fx.store, { id: 'w-1', owner: 'ses-b/reviewer', session: 'ses-b', agent: 'reviewer', until: t(60), now: t(4) }).claimOwner, 'ses-b/reviewer');
    assert.equal(acceptWork(fx.store, { id: 'w-2', owner: 'ses-b/main', session: 'ses-b', until: t(60), now: t(4) }).claimOwner, 'ses-b/main');
  } finally {
    fx.cleanup();
  }
});

test('an offer that lapses with its claim cannot be accepted; the next claim takes the packet with it', () => {
  const fx = freshStore();
  try {
    item(fx.store);
    const a = claimWork(fx.store, { id: 'w-1', owner: 'ses-a/main', session: 'ses-a', until: t(30), now: t(1) });
    handoffWork(fx.store, { id: 'w-1', owner: 'ses-a/main', token: a.claimToken, packet: PACKET, now: t(2) });
    const lapse = (Date.parse(t(2)) + HANDOFF_HOLD_MS - T0) / 60_000 + 1;
    assert.throws(() => acceptWork(fx.store, { id: 'w-1', owner: 'ses-b/main', session: 'ses-b', until: t(lapse + 30), now: t(lapse) }), /lapsed with its claim; claim the work instead/);
    claimWork(fx.store, { id: 'w-1', owner: 'ses-c/main', session: 'ses-c', until: t(lapse + 30), now: t(lapse) });
    const h = handoffOf(fx.store, 'w-1')!;
    assert.deepEqual([h.takenBy, h.takenVia, h.packet.state], ['ses-c/main', 'claim', 'parser half done; lexer untouched']);
  } finally {
    fx.cleanup();
  }
});

test('an offer the holder releases is withdrawn', () => {
  const fx = freshStore();
  try {
    item(fx.store);
    const a = claimWork(fx.store, { id: 'w-1', owner: 'ses-a/main', session: 'ses-a', until: t(30), now: t(1) });
    handoffWork(fx.store, { id: 'w-1', owner: 'ses-a/main', token: a.claimToken, packet: PACKET, now: t(2) });
    releaseWork(fx.store, { id: 'w-1', owner: 'ses-a/main', token: a.claimToken, at: t(3) });
    assert.equal(listOffers(fx.store, t(4)).length, 0);
    assert.throws(() => acceptWork(fx.store, { id: 'w-1', owner: 'ses-b/main', session: 'ses-b', until: t(60), now: t(4) }), /withdrawn when its holder released it/);
  } finally {
    fx.cleanup();
  }
});

test('a packet says where the work stands and what comes next, bounded, without control bytes or credentials', () => {
  const key = 'sk-' + 'ant-' + 'api03-' + 'abcdefghijklmnopqrstuvwxyz0123456789';
  const p = normalizePacket({ state: `done\u001b[31m; token ${key}`, next: 'ship', openQuestions: 'which flag?' });
  assert.equal(p.state, 'done[31m; token [redacted]');
  assert.deepEqual(p.openQuestions, ['which flag?']);
  assert.deepEqual(p.where, { branch: null, commit: null, paths: [] });
  assert.throws(() => normalizePacket({ state: 'x' }), /says next/);
  assert.throws(() => normalizePacket({ state: '   ', next: 'y' }), /says state/);
  assert.throws(() => normalizePacket({ state: 'x'.repeat(2001), next: 'y' }), /at most 2000/);
  assert.throws(() => normalizePacket({ state: 'x', next: 'y', watchOut: Array.from({ length: 21 }, () => 'z') }), /at most 20/);
  assert.throws(() => normalizePacket({ state: 'x', next: 'y', where: { commit: 'not-a-sha' } }), /git commit id/);
  assert.throws(() => normalizePacket({ state: 'x', next: 'y', where: { paths: ['../out'] } }), HandoffPacketError);
});

test('a handoff moves no approval: grants stay with the session that was given them', () => {
  const fx = freshStore();
  try {
    item(fx.store);
    const before = fx.store.db.prepare('SELECT COUNT(*) AS n FROM grants').get() as { n: number };
    const a = claimWork(fx.store, { id: 'w-1', owner: 'ses-a/main', session: 'ses-a', until: t(30), now: t(1) });
    handoffWork(fx.store, { id: 'w-1', owner: 'ses-a/main', token: a.claimToken, packet: PACKET, now: t(2) });
    acceptWork(fx.store, { id: 'w-1', owner: 'ses-b/main', session: 'ses-b', until: t(60), now: t(3) });
    const after = fx.store.db.prepare('SELECT COUNT(*) AS n FROM grants').get() as { n: number };
    assert.equal(after.n, before.n);
    const touched = fx.store.db.prepare(`SELECT COUNT(*) AS n FROM step_runs WHERE lease_owner LIKE 'ses-b%'`).get() as { n: number };
    assert.equal(touched.n, 0, 'no step lease moved');
  } finally {
    fx.cleanup();
  }
});
