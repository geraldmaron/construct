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
import { randomBytes } from 'node:crypto';
import type { StateStore } from '../../../src/kernel/state/open.ts';
import { freshStore } from '../state/support.ts';
import {
  acceptWork,
  claimWork,
  completeWork,
  createWork,
  handoffOf,
  handoffWork,
  listOffers,
  releaseWork,
  takeoverWork,
  HANDOFF_HOLD_MS,
} from '../../../src/kernel/work/service.ts';
import { HandoffPacketError, normalizePacket } from '../../../src/kernel/work/handoff.ts';
import { leasesFor } from '../../../src/kernel/work/leases.ts';

const T0 = Date.parse('2026-09-24T12:00:00.000Z');
const t = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();
const PACKET = {
  state: 'parser half done; lexer untouched',
  next: 'finish src/parser/expr.ts',
  watchOut: ['the old grammar test is flaky'],
  where: { branch: 'feat/parser', commit: 'A1B2C3D', paths: ['src/parser/'] },
};

function item(store: StateStore, id = 'w-1'): void {
  createWork(store, { id, kind: 'task', title: id, description: id, at: t(0), actor: 'test' });
}

test('the holder offers with its token; the acceptor gets the claim, a new token, and the reservations; the old token is dead', () => {
  const fx = freshStore();
  try {
    item(fx.store);
    const a = claimWork(fx.store, { id: 'w-1', owner: 'ses-a/main', session: 'ses-a', until: t(30), now: t(1), paths: ['src/parser/'] });
    assert.throws(
      () => handoffWork(fx.store, { id: 'w-1', owner: 'ses-a/main', token: 'guess', packet: PACKET, now: t(2) }),
      /only its holder hands it off/,
    );
    assert.throws(
      () => handoffWork(fx.store, { id: 'w-1', owner: 'ses-b/main', token: a.claimToken, packet: PACKET, now: t(2) }),
      /only its holder hands it off/,
    );
    assert.throws(
      () => handoffWork(fx.store, { id: 'w-1', owner: 'ses-a/main', token: a.claimToken, packet: PACKET, to: 'ses-a/main', now: t(2) }),
      /someone else/,
    );

    const offered = handoffWork(fx.store, { id: 'w-1', owner: 'ses-a/main', token: a.claimToken, packet: PACKET, now: t(2) });
    assert.equal(offered.claimOwner, 'ses-a/main', 'still the holder’s until accepted');
    assert.equal(offered.claimUntil, new Date(Date.parse(t(2)) + HANDOFF_HOLD_MS).toISOString(), 'held long enough to be accepted');
    assert.equal(offered.handoff.packet.where.commit, 'a1b2c3d');
    assert.deepEqual(
      listOffers(fx.store, t(3)).map((o) => o.work.id),
      ['w-1'],
    );
    assert.deepEqual(listOffers(fx.store, t(3), { owner: 'ses-a/main', session: 'ses-a' }), [], 'not an offer to its own offerer');
    assert.throws(() => acceptWork(fx.store, { id: 'w-1', owner: 'ses-a/main', session: 'ses-a', until: t(60), now: t(3) }), /you offered/);

    const b = acceptWork(fx.store, {
      id: 'w-1',
      owner: 'ses-b/main',
      session: 'ses-b',
      agent: 'main',
      lane: '/lanes/b',
      branch: 'feat/parser',
      until: t(60),
      now: t(4),
    });
    assert.equal(b.claimOwner, 'ses-b/main');
    assert.notEqual(b.claimToken, a.claimToken);
    assert.deepEqual([b.handoff.takenBy, b.handoff.takenVia, b.handoff.packet.next], ['ses-b/main', 'accept', 'finish src/parser/expr.ts']);
    assert.deepEqual(
      leasesFor(fx.store, 'w-1').map((l) => [l.path, l.sessionId, l.laneRoot, l.branch]),
      [['src/parser/', 'ses-b', '/lanes/b', 'feat/parser']],
    );
    assert.throws(
      () => completeWork(fx.store, { id: 'w-1', owner: 'ses-a/main', token: a.claimToken, at: t(5) }),
      /held by ses-b\/main|do not hold/,
    );
    assert.throws(
      () => acceptWork(fx.store, { id: 'w-1', owner: 'ses-c/main', session: 'ses-c', until: t(60), now: t(5) }),
      /no open handoff/,
      'accepted once',
    );
    assert.equal(listOffers(fx.store, t(5)).length, 0);
    assert.equal(completeWork(fx.store, { id: 'w-1', owner: 'ses-b/main', token: b.claimToken, at: t(6) }).status, 'completed');
    const events = fx.store.db
      .prepare(`SELECT kind, actor FROM work_events WHERE work_id = 'w-1' AND kind LIKE 'handoff%' ORDER BY id`)
      .all() as { kind: string; actor: string }[];
    assert.deepEqual(
      events.map((e) => [e.kind, e.actor]),
      [
        ['handoff_offered', 'ses-a/main'],
        ['handoff_accepted', 'ses-b/main'],
      ],
    );
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
    assert.deepEqual(
      listOffers(fx.store, t(3), { owner: 'ses-b/main', session: 'ses-b' }).map((o) => o.work.id),
      ['w-2'],
    );
    assert.deepEqual(
      listOffers(fx.store, t(3), { owner: 'ses-b/reviewer', session: 'ses-b' }).map((o) => o.work.id),
      ['w-1', 'w-2'],
    );
    assert.throws(
      () => acceptWork(fx.store, { id: 'w-1', owner: 'ses-c/main', session: 'ses-c', until: t(60), now: t(4) }),
      /offered to ses-b\/reviewer/,
    );
    assert.throws(
      () => acceptWork(fx.store, { id: 'w-1', owner: 'ses-b/main', session: 'ses-b', until: t(60), now: t(4) }),
      /offered to ses-b\/reviewer/,
    );
    assert.equal(
      acceptWork(fx.store, { id: 'w-1', owner: 'ses-b/reviewer', session: 'ses-b', agent: 'reviewer', until: t(60), now: t(4) }).claimOwner,
      'ses-b/reviewer',
    );
    assert.equal(
      acceptWork(fx.store, { id: 'w-2', owner: 'ses-b/main', session: 'ses-b', until: t(60), now: t(4) }).claimOwner,
      'ses-b/main',
    );
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
    assert.throws(
      () => acceptWork(fx.store, { id: 'w-1', owner: 'ses-b/main', session: 'ses-b', until: t(lapse + 30), now: t(lapse) }),
      /lapsed with its claim; claim the work instead/,
    );
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
    assert.throws(
      () => acceptWork(fx.store, { id: 'w-1', owner: 'ses-b/main', session: 'ses-b', until: t(60), now: t(4) }),
      /withdrawn when its holder released it/,
    );
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

test('a handoff offered to someone is theirs even after the offerer’s session ends, until its hold lapses', () => {
  const fx = freshStore();
  try {
    item(fx.store);
    fx.store.db
      .prepare(
        `INSERT INTO sessions (id, host, surface, machine, started_at, last_seen_at, ended_at) VALUES ('ses-a', 'claude-code', 'interactive', 'test', ?, ?, ?)`,
      )
      .run(t(0), t(3), t(3));
    const a = claimWork(fx.store, { id: 'w-1', owner: 'ses-a/main', session: 'ses-a', until: t(30), now: t(1) });
    handoffWork(fx.store, { id: 'w-1', owner: 'ses-a/main', token: a.claimToken, packet: PACKET, to: 'ses-b', now: t(2) });
    assert.throws(
      () =>
        takeoverWork(fx.store, {
          id: 'w-1',
          owner: 'ses-c/main',
          session: 'ses-c',
          agent: 'main',
          until: t(60),
          now: t(5),
          reason: 'it looked abandoned',
        }),
      /offered as a handoff to ses-b .* only they may take it/,
    );
    assert.throws(
      () =>
        takeoverWork(fx.store, {
          id: 'w-1',
          owner: 'ses-b/main',
          session: 'ses-b',
          agent: 'main',
          until: t(60),
          now: t(5),
          reason: 'mine',
        }),
      /offered to you as a handoff; accept it instead/,
    );
    assert.equal(
      acceptWork(fx.store, { id: 'w-1', owner: 'ses-b/main', session: 'ses-b', until: t(60), now: t(6) }).claimOwner,
      'ses-b/main',
    );
  } finally {
    fx.cleanup();
  }
});

test('the offerer renewing its claim keeps the handoff’s longer hold', () => {
  const fx = freshStore();
  try {
    item(fx.store);
    const a = claimWork(fx.store, { id: 'w-1', owner: 'ses-a/main', session: 'ses-a', until: t(30), now: t(1) });
    const offered = handoffWork(fx.store, { id: 'w-1', owner: 'ses-a/main', token: a.claimToken, packet: PACKET, now: t(2) });
    const renewed = claimWork(fx.store, { id: 'w-1', owner: 'ses-a/main', session: 'ses-a', token: a.claimToken, until: t(33), now: t(3) });
    assert.equal(renewed.claimUntil, offered.claimUntil);
  } finally {
    fx.cleanup();
  }
});

test('accepting a handoff releases, rather than imports, a reservation another claim holds in the acceptor’s checkout', () => {
  const fx = freshStore();
  try {
    item(fx.store, 'w-1');
    item(fx.store, 'w-2');
    const a = claimWork(fx.store, {
      id: 'w-1',
      owner: 'ses-a/main',
      session: 'ses-a',
      until: t(30),
      now: t(1),
      paths: ['src/x.ts', 'docs/x.md'],
    });
    claimWork(fx.store, {
      id: 'w-2',
      owner: 'ses-c/main',
      session: 'ses-c',
      lane: '/lanes/b',
      until: t(60),
      now: t(1),
      paths: ['src/x.ts'],
    });
    handoffWork(fx.store, { id: 'w-1', owner: 'ses-a/main', token: a.claimToken, packet: PACKET, now: t(2) });
    const b = acceptWork(fx.store, { id: 'w-1', owner: 'ses-b/main', session: 'ses-b', lane: '/lanes/b', until: t(60), now: t(3) });
    assert.deepEqual(
      b.leases!.map((l) => l.path),
      ['docs/x.md'],
    );
    assert.deepEqual(
      b.dropped!.map((o) => [o.workId, o.heldPath]),
      [['w-2', 'src/x.ts']],
    );
  } finally {
    fx.cleanup();
  }
});

test('handoff locations reject coerced identifiers rather than inventing paths or commit ids', () => {
  assert.throws(() => normalizePacket({ state: 'done', next: 'verify', where: { paths: [42] } }), HandoffPacketError);
  assert.throws(() => normalizePacket({ state: 'done', next: 'verify', where: { commit: 1234567 } }), HandoffPacketError);
});

test('descriptive filenames survive handoff without widening its actual reservations', () => {
  const fx = freshStore();
  try {
    item(fx.store);
    const a = claimWork(fx.store, { id: 'w-1', owner: 'a', paths: ['briefs/'], until: t(30), now: t(1) });
    const paths = ['briefs/Release Notes.md', 'Team Briefs/Review Notes.md'];
    const offered = handoffWork(fx.store, {
      id: 'w-1',
      owner: 'a',
      token: a.claimToken,
      packet: { state: 'Draft ready', next: 'Review the notes', where: { paths } },
      to: 'b',
      now: t(2),
    });
    assert.deepEqual(offered.handoff.packet.where.paths, paths);
    const b = acceptWork(fx.store, { id: 'w-1', owner: 'b', until: t(60), now: t(3) });
    assert.deepEqual(b.handoff.packet.where.paths, paths);
    assert.deepEqual(
      b.leases!.map((l) => l.path),
      ['briefs/'],
    );
    assert.notEqual(b.claimToken, a.claimToken);
    assert.equal(completeWork(fx.store, { id: 'w-1', owner: 'b', token: b.claimToken, at: t(4) }).status, 'completed');
  } finally {
    fx.cleanup();
  }
});

test('descriptive handoff paths stay bounded and refuse traversal and hidden controls', () => {
  const packet = (path: string) => ({ state: 'Draft ready', next: 'Review', where: { paths: [path] } });
  for (const path of [
    '../escape.md',
    '/etc/passwd',
    'C:\\outside.md',
    'briefs/../escape.md',
    'briefs/line\nnotes.md',
    'briefs/tab\tnotes.md',
    'briefs/hidden\u200bnotes.md',
    'briefs/nul\u0000notes.md',
    'é'.repeat(257),
  ]) {
    assert.throws(() => normalizePacket(packet(path)), HandoffPacketError, JSON.stringify(path));
  }
  assert.deepEqual(normalizePacket(packet('é'.repeat(256))).where.paths, ['é'.repeat(256)]);
});

test('a private acceptance capability recovers only its live exact handoff generation without renewing it', () => {
  const fx = freshStore();
  const acceptanceKey = randomBytes(32).toString('hex');
  try {
    item(fx.store);
    const a = claimWork(fx.store, { id: 'w-1', owner: 'a', paths: ['src/'], until: t(30), now: t(1) });
    const offerId = handoffWork(fx.store, { id: 'w-1', owner: 'a', token: a.claimToken, packet: PACKET, now: t(2) }).handoff.offerId!;
    const accepted = acceptWork(fx.store, {
      id: 'w-1',
      owner: 'b',
      session: 'b-session',
      lane: '/lanes/b',
      acceptanceKey,
      offerId,
      until: t(40),
      now: t(3),
    });
    const revision = accepted.revision;
    const retry = acceptWork(fx.store, {
      id: 'w-1',
      owner: 'b',
      session: 'b-session',
      lane: '/lanes/b',
      acceptanceKey,
      offerId,
      until: t(90),
      now: t(4),
    });
    assert.equal(retry.claimToken, accepted.claimToken);
    assert.equal(retry.claimUntil, t(40));
    assert.equal(retry.revision, revision);
    assert.deepEqual(retry.leases, accepted.leases);
    item(fx.store, 'w-2');
    const second = claimWork(fx.store, { id: 'w-2', owner: 'a', until: t(40), now: t(4) });
    handoffWork(fx.store, { id: 'w-2', owner: 'a', token: second.claimToken, packet: PACKET, now: t(4) });
    assert.throws(
      () =>
        acceptWork(fx.store, {
          id: 'w-2',
          owner: 'b',
          session: 'b-session',
          lane: '/lanes/b',
          acceptanceKey,
          offerId,
          until: t(90),
          now: t(4),
        }),
      /acceptance|generation|recover/,
    );
    assert.equal(handoffOf(fx.store, 'w-2')!.takenBy, null);
    for (const patch of [
      { acceptanceKey: randomBytes(32).toString('hex') },
      { owner: 'c' },
      { session: 'other-session' },
      { lane: '/lanes/c' },
    ]) {
      assert.throws(
        () =>
          acceptWork(fx.store, {
            id: 'w-1',
            owner: 'b',
            session: 'b-session',
            lane: '/lanes/b',
            acceptanceKey,
            offerId,
            until: t(90),
            now: t(4),
            ...patch,
          }),
        /handoff|acceptance|recover/,
      );
    }
    assert.throws(
      () =>
        acceptWork(fx.store, {
          id: 'w-1',
          owner: 'b',
          session: 'b-session',
          lane: '/lanes/b',
          acceptanceKey,
          offerId,
          until: t(90),
          now: t(40),
        }),
      /acceptance|expired|recover/,
    );
    releaseWork(fx.store, { id: 'w-1', owner: 'b', token: accepted.claimToken, at: t(5) });
    const next = claimWork(fx.store, { id: 'w-1', owner: 'c', until: t(50), now: t(6) });
    handoffWork(fx.store, { id: 'w-1', owner: 'c', token: next.claimToken, packet: PACKET, now: t(7) });
    assert.throws(
      () =>
        acceptWork(fx.store, {
          id: 'w-1',
          owner: 'b',
          session: 'b-session',
          lane: '/lanes/b',
          acceptanceKey,
          offerId,
          until: t(90),
          now: t(8),
        }),
      /acceptance|generation|recover/,
    );
    const fresh = acceptWork(fx.store, {
      id: 'w-1',
      owner: 'b',
      session: 'b-session',
      acceptanceKey: randomBytes(32).toString('hex'),
      offerId: handoffOf(fx.store, 'w-1')!.offerId,
      until: t(90),
      now: t(9),
    });
    assert.notEqual(fresh.claimToken, accepted.claimToken);
    assert.ok(!JSON.stringify(fx.store.db.prepare('SELECT payload_json FROM work_events').all()).includes(acceptanceKey));
  } finally {
    fx.cleanup();
  }
});

test('failed acceptance does not consume its recovery capability', () => {
  const fx = freshStore(),
    acceptanceKey = randomBytes(32).toString('hex');
  try {
    item(fx.store);
    const a = claimWork(fx.store, { id: 'w-1', owner: 'a', paths: ['src/'], until: t(30), now: t(1) });
    const offerId = handoffWork(fx.store, { id: 'w-1', owner: 'a', token: a.claimToken, packet: PACKET, now: t(2) }).handoff.offerId!;
    fx.store.db.exec(
      "CREATE TEMP TRIGGER refuse_acceptance BEFORE INSERT ON work_events WHEN NEW.kind = 'handoff_acceptance_receipt' BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END",
    );
    assert.throws(
      () => acceptWork(fx.store, { id: 'w-1', owner: 'b', acceptanceKey, offerId, until: t(60), now: t(3) }),
      /injected receipt failure/,
    );
    assert.equal(handoffOf(fx.store, 'w-1')!.takenBy, null);
    assert.equal(leasesFor(fx.store, 'w-1')[0]!.sessionId, 'a');
    fx.store.db.exec('DROP TRIGGER refuse_acceptance');
    const accepted = acceptWork(fx.store, { id: 'w-1', owner: 'b', acceptanceKey, offerId, until: t(60), now: t(4) });
    assert.equal(
      acceptWork(fx.store, { id: 'w-1', owner: 'b', acceptanceKey, offerId, until: t(90), now: t(5) }).claimToken,
      accepted.claimToken,
    );
  } finally {
    fx.cleanup();
  }
});

test('an unused acceptance capability cannot consume a later offer after a predispatch race', () => {
  const fx = freshStore(),
    acceptanceKey = randomBytes(32).toString('hex');
  try {
    item(fx.store);
    const a = claimWork(fx.store, { id: 'w-1', owner: 'a', paths: ['src/'], until: t(30), now: t(1) });
    const stale = handoffWork(fx.store, { id: 'w-1', owner: 'a', token: a.claimToken, packet: PACKET, now: t(2) }).handoff;
    // The original request has not reached the store; even a same-timestamp,
    // same-packet replacement is a different immutable offer generation.
    const fresh = handoffWork(fx.store, { id: 'w-1', owner: 'a', token: a.claimToken, packet: PACKET, now: t(2) }).handoff;
    assert.notEqual(stale.offerId, fresh.offerId);
    const before = JSON.stringify(fx.store.db.prepare('SELECT * FROM work_items').all());
    const events = fx.store.db.prepare('SELECT COUNT(*) AS n FROM work_events').get()!.n;
    assert.throws(
      () => acceptWork(fx.store, { id: 'w-1', owner: 'b', acceptanceKey, offerId: stale.offerId, until: t(60), now: t(3) }),
      /generation changed/,
    );
    assert.equal(JSON.stringify(fx.store.db.prepare('SELECT * FROM work_items').all()), before);
    assert.equal(fx.store.db.prepare('SELECT COUNT(*) AS n FROM work_events').get()!.n, events);
    assert.equal(leasesFor(fx.store, 'w-1')[0]!.sessionId, 'a');
    assert.equal(
      acceptWork(fx.store, { id: 'w-1', owner: 'b', acceptanceKey, offerId: fresh.offerId, until: t(60), now: t(4) }).handoff.offerId,
      fresh.offerId,
    );
  } finally {
    fx.cleanup();
  }
});

test('legacy offers acquire a stable public identity without a storage migration and malformed capabilities have no effects', () => {
  const fx = freshStore();
  try {
    item(fx.store);
    const a = claimWork(fx.store, { id: 'w-1', owner: 'a', until: t(30), now: t(1) });
    handoffWork(fx.store, { id: 'w-1', owner: 'a', token: a.claimToken, packet: PACKET, now: t(2) });
    fx.store.db.prepare("UPDATE work_items SET handoff_json = json_remove(handoff_json, '$.offerId') WHERE id = ?").run('w-1');
    const legacy = handoffOf(fx.store, 'w-1')!;
    assert.equal(handoffOf(fx.store, 'w-1')!.offerId, legacy.offerId);
    for (const patch of [{ acceptanceKey: 'passphrase', offerId: legacy.offerId }, { acceptanceKey: randomBytes(32).toString('hex') }]) {
      assert.throws(() => acceptWork(fx.store, { id: 'w-1', owner: 'b', until: t(60), now: t(3), ...patch }), /acceptance|offerId/);
      assert.equal(handoffOf(fx.store, 'w-1')!.takenBy, null);
    }
    const acceptanceKey = randomBytes(32).toString('hex');
    const accepted = acceptWork(fx.store, { id: 'w-1', owner: 'b', acceptanceKey, offerId: legacy.offerId, until: t(60), now: t(4) });
    assert.equal(
      acceptWork(fx.store, { id: 'w-1', owner: 'b', acceptanceKey, offerId: legacy.offerId, until: t(90), now: t(5) }).claimToken,
      accepted.claimToken,
    );
  } finally {
    fx.cleanup();
  }
});
