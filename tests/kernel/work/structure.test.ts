/**
 * tests/kernel/work/structure.test.ts — work enters the backlog with a reason,
 * carries its parent, dependencies, and acceptance criteria, and cannot be
 * finished around its own structure.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, clock } from '../state/support.ts';
import { addEntity, setEntityStatus } from '../../../src/kernel/state/graph.ts';
import { addStatement } from '../../../src/kernel/state/profile.ts';
import { bindGoverningStatement } from '../../../src/kernel/state/admission.ts';
import { DELEGATION_ATTEMPT_EVENT, cancelWork, claimWork, completeWork, getWork, listReady, markPremisesStale, queryWork, readinessOf, releaseWork, requalifyWork, updateWork } from '../../../src/kernel/work/service.ts';
import { admitProposedWork, fileWork, linkWork, unlinkWork, workStructure } from '../../../src/kernel/work/structure.ts';

function ids() {
  let n = 0;
  return (p: string) => `${p}-${String(++n)}`;
}

test('work without a reason is proposed: never ready or claimable until a reason or the person admits it', () => {
  const fx = freshStore();
  try {
    const at = clock();
    const nextId = ids();
    const loose = fileWork(fx.store, { id: 'w-loose', kind: 'task', title: 'Loose idea', byPerson: false, at: at(), nextId });
    assert.equal(loose.work.status, 'proposed');
    assert.equal(loose.admitted, false);
    assert.match(loose.next ?? '', /construct work admit/);
    assert.deepEqual(listReady(fx.store, at()).map((w) => w.id), []);
    assert.throws(() => claimWork(fx.store, { id: 'w-loose', owner: 'a', until: '2026-09-02T11:00:00.000Z', now: at() }), /not ready: still proposed/);
    assert.throws(() => admitProposedWork(fx.store, { id: 'w-loose', byPerson: false, at: at() }), /no reason to exist yet/);

    const sessionOutcome = fileWork(fx.store, { id: 'w-sess', kind: 'outcome', title: 'A session’s own outcome', byPerson: false, at: at(), nextId });
    assert.equal(sessionOutcome.work.status, 'proposed', 'an outcome is no bypass');
    const underProposed = fileWork(fx.store, { id: 'w-under', kind: 'task', title: 'Under it', parentId: 'w-sess', byPerson: false, at: at(), nextId });
    assert.equal(underProposed.work.status, 'proposed', 'a proposed parent is not a reason');
    assert.throws(() => admitProposedWork(fx.store, { id: 'w-under', byPerson: false, at: at() }), /no reason to exist yet/);
    admitProposedWork(fx.store, { id: 'w-sess', byPerson: true, at: at() });
    assert.equal(getWork(fx.store, 'w-under')!.status, 'open', 'admitting a parent admits its proposed children');

    const outcome = fileWork(fx.store, { id: 'w-out', kind: 'outcome', title: 'Ship the parser', byPerson: true, at: at(), nextId });
    assert.equal(outcome.work.status, 'open');
    assert.equal(outcome.admittedBy, 'person');

    const linked = linkWork(fx.store, { id: 'w-loose', parentId: 'w-out', at: at(), nextId });
    assert.equal(linked.status, 'open', 'gaining an admitted parent admits it');
    assert.equal(workStructure(fx.store, linked).admittedBy, 'parent');

    const personal = fileWork(fx.store, { id: 'w-mine', kind: 'task', title: 'Rename a helper', byPerson: true, at: at(), nextId });
    assert.equal(personal.work.status, 'open');
    assert.equal(personal.admittedBy, 'person');

    const held = fileWork(fx.store, { id: 'w-held', kind: 'task', title: 'Later', byPerson: false, at: at(), nextId });
    assert.equal(admitProposedWork(fx.store, { id: held.work.id, byPerson: true, at: at() }).status, 'open');
    assert.equal(workStructure(fx.store, getWork(fx.store, held.work.id)!).admittedBy, 'person');
  } finally {
    fx.cleanup();
  }
});

test('work serving a confirmed decision or an active metric is admitted; a note or an unconfirmed proposal is not a reason', () => {
  const fx = freshStore();
  try {
    const at = clock();
    const nextId = ids();
    const decision = addStatement(fx.store, { id: 'st-d', kind: 'decision', text: 'One store per project', provenance: 'user', at: at() });
    bindGoverningStatement(fx.store, decision, at(), nextId);
    const byStatement = fileWork(fx.store, { id: 'w-d', kind: 'task', title: 'Stamp the store', serves: 'st-d', byPerson: false, at: at(), nextId });
    assert.equal(byStatement.work.status, 'open');
    assert.equal(byStatement.admittedBy, 'serves');
    assert.equal(workStructure(fx.store, byStatement.work).serves[0]?.kind, 'decision');

    const metric = addEntity(fx.store, { id: 'ent-m', kind: 'metric', name: 'p95 claim latency', at: at() });
    const byMetric = fileWork(fx.store, { id: 'w-m', kind: 'task', title: 'Index claims', serves: metric.id, byPerson: false, at: at(), nextId });
    assert.equal(byMetric.work.status, 'open');

    addStatement(fx.store, { id: 'st-n', kind: 'note', text: 'look at invoices', provenance: 'user', at: at() });
    assert.throws(() => fileWork(fx.store, { id: 'w-n', kind: 'task', title: 'Invoices', serves: 'st-n', byPerson: false, at: at(), nextId }), /not a reason for work/);
    assert.equal(queryWork(fx.store, { query: 'w-n' }).total, 0, 'a refused filing writes nothing');
  } finally {
    fx.cleanup();
  }
});

test('blocked-by holds work out of ready until the blocker finishes; parents cannot cycle', () => {
  const fx = freshStore();
  try {
    const at = clock();
    const nextId = ids();
    const outcome = fileWork(fx.store, { id: 'w-o', kind: 'outcome', title: 'Outcome', byPerson: true, at: at(), nextId }).work;
    const first = fileWork(fx.store, { id: 'w-1', kind: 'task', title: 'Schema', parentId: outcome.id, byPerson: false, at: at(), nextId }).work;
    const second = fileWork(fx.store, { id: 'w-2', kind: 'task', title: 'Migration', parentId: outcome.id, blockedBy: [first.id], related: [outcome.id], byPerson: false, at: at(), nextId }).work;
    assert.deepEqual(listReady(fx.store, at()).map((w) => w.id).sort(), ['w-1', 'w-o']);
    const s = workStructure(fx.store, second);
    assert.deepEqual(s.blockedBy.map((b) => b.id), ['w-1']);
    assert.deepEqual(s.related.map((b) => b.id), ['w-o']);
    assert.deepEqual(workStructure(fx.store, first).blocking.map((b) => b.id), ['w-2']);

    assert.throws(() => linkWork(fx.store, { id: outcome.id, parentId: second.id, at: at(), nextId }), /inside itself/);

    completeWork(fx.store, { id: first.id, owner: 't', at: at(), reason: 'done' });
    assert.ok(listReady(fx.store, at()).some((w) => w.id === 'w-2'));

    unlinkWork(fx.store, { id: second.id, related: [outcome.id], at: at() });
    assert.deepEqual(workStructure(fx.store, second).related, []);
  } finally {
    fx.cleanup();
  }
});

test('an item with open children cannot finish, and acceptance criteria need a reason saying how they were met', () => {
  const fx = freshStore();
  try {
    const at = clock();
    const nextId = ids();
    const outcome = fileWork(fx.store, { id: 'w-o', kind: 'outcome', title: 'Outcome', byPerson: true, at: at(), nextId }).work;
    const child = fileWork(fx.store, {
      id: 'w-c',
      kind: 'task',
      title: 'Child',
      parentId: outcome.id,
      acceptance: ['the migration is reversible', ' '],
      risk: 'locks the table',
      sources: ['src-schema'],
      byPerson: false,
      at: at(),
      nextId,
    }).work;
    const s = workStructure(fx.store, child);
    assert.deepEqual(s.acceptance, ['the migration is reversible']);
    assert.equal(s.risk, 'locks the table');
    assert.deepEqual(s.sources, ['src-schema']);

    assert.throws(() => completeWork(fx.store, { id: outcome.id, owner: 't', at: at() }), /1 open child item\(s\): w-c/);
    assert.throws(() => cancelWork(fx.store, { id: outcome.id, actor: 't', at: at(), reason: 'dropped' }), /open child/);
    assert.throws(() => completeWork(fx.store, { id: child.id, owner: 't', at: at() }), /acceptance criteria; say how they were met/);
    completeWork(fx.store, { id: child.id, owner: 't', at: at(), reason: 'reversed and re-applied on a copy' });
    assert.equal(completeWork(fx.store, { id: outcome.id, owner: 't', at: at() }).status, 'completed');
    assert.equal(workStructure(fx.store, outcome).children[0]?.status, 'completed');
    assert.throws(() => fileWork(fx.store, { id: 'w-late', kind: 'task', title: 'Late', parentId: outcome.id, byPerson: false, at: at(), nextId }), /finished work is not a reason/);
  } finally {
    fx.cleanup();
  }
});

test('a superseded decision is no reason, a stale premise survives edits until requalified, and delegated attempts end with their parent', () => {
  const fx = freshStore();
  try {
    const at = clock();
    const nextId = ids();
    const decision = addEntity(fx.store, { id: 'ent-d', kind: 'decision', name: 'Old plan', at: at() });
    const served = fileWork(fx.store, { id: 'w-s', kind: 'task', title: 'Old work', serves: decision.id, byPerson: false, at: at(), nextId });
    assert.equal(served.work.status, 'open');
    setEntityStatus(fx.store, decision.id, 'superseded', at());
    assert.throws(() => fileWork(fx.store, { id: 'w-s2', kind: 'task', title: 'New', serves: decision.id, byPerson: false, at: at(), nextId }), /not an active reason/);
    assert.deepEqual(workStructure(fx.store, getWork(fx.store, 'w-s')!).serves, []);

    const sourced = fileWork(fx.store, { id: 'w-src', kind: 'task', title: 'Sourced', sources: ['src-a'], byPerson: true, at: at(), nextId }).work;
    markPremisesStale(fx.store, 'src-a', at());
    assert.equal(listReady(fx.store, at()).some((w) => w.id === sourced.id), false);
    updateWork(fx.store, { id: sourced.id, expectedRevision: getWork(fx.store, sourced.id)!.revision, at: at(), premises: { sources: ['src-a'] } });
    assert.match(readinessOf(fx.store, getWork(fx.store, sourced.id)!, at()).blockers.join(' '), /requalify/, 'an edit does not clear the stale mark');
    assert.throws(() => requalifyWork(fx.store, { id: sourced.id, reason: ' ', at: at() }));
    const requalified = requalifyWork(fx.store, { id: sourced.id, reason: 'checked the new schema; still valid', at: at() });
    assert.equal(requalified.status, 'open');
    assert.equal(readinessOf(fx.store, requalified, at()).ready, true);

    const parent = fileWork(fx.store, { id: 'w-lead', kind: 'task', title: 'Lead work', byPerson: true, at: at(), nextId }).work;
    const attempt = fileWork(fx.store, { id: 'w-attempt', kind: 'task', title: 'Bounded implement', parentId: parent.id, acceptance: ['tests pass'], byPerson: false, at: at(), nextId }).work;
    fx.store.db.prepare('INSERT INTO work_events (work_id, at, kind, actor, payload_json) VALUES (?, ?, ?, ?, ?)').run(attempt.id, at(), DELEGATION_ATTEMPT_EVENT, 'lead', '{}');
    const claim = claimWork(fx.store, { id: attempt.id, owner: 'worker', until: '2026-09-02T12:00:00.000Z', now: at() });
    assert.throws(() => completeWork(fx.store, { id: parent.id, owner: 't', at: at() }), /delegated attempt still running/);
    releaseWork(fx.store, { id: attempt.id, owner: 'worker', token: claim.claimToken, at: at() });
    assert.equal(completeWork(fx.store, { id: parent.id, owner: 't', at: at() }).status, 'completed');
    const ended = getWork(fx.store, attempt.id)!;
    assert.equal(ended.status, 'cancelled');
    assert.match(ended.reason ?? '', /parent w-lead was completed/);
  } finally {
    fx.cleanup();
  }
});
