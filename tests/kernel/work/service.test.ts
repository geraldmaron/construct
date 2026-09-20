/**
 * tests/kernel/work/service.test.ts — native work ledger: identity, claims,
 * readiness, export/restore, and revision checks.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, clock } from '../state/support.ts';
import {
  addWorkDependency,
  claimWork,
  completeWork,
  createWork,
  exportWork,
  listReady,
  queryWork,
  reopenWork,
  restoreWork,
  updateWork,
} from '../../../src/kernel/work/service.ts';

test('create, query, claim with fencing, complete, and reopen', () => {
  const fx = freshStore();
  try {
    const at = clock();
    const a = createWork(fx.store, { id: 'w-a', kind: 'task', title: 'Do A', description: 'A', at: at(), actor: 't' });
    const b = createWork(fx.store, { id: 'w-b', kind: 'task', title: 'Do B', description: 'B', at: at(), actor: 't' });
    addWorkDependency(fx.store, { id: 'd1', fromId: b.id, toId: a.id, kind: 'blocks', at: at() });
    assert.equal(listReady(fx.store, at()).map((w) => w.id).join(','), 'w-a');
    const now = at();
    const claimed = claimWork(fx.store, { id: a.id, owner: 's1', until: new Date(Date.parse(now) + 60_000).toISOString(), now });
    assert.equal(claimed.status, 'claimed');
    assert.throws(() => claimWork(fx.store, { id: a.id, owner: 's2', until: new Date(Date.parse(now) + 60_000).toISOString(), now }), /claimed by s1/);
    completeWork(fx.store, { id: a.id, owner: 's1', token: claimed.claimToken!, at: at() });
    assert.equal(listReady(fx.store, at())[0]?.id, 'w-b');
    const page = queryWork(fx.store, { query: 'Do A' });
    assert.equal(page.total, 1);
    reopenWork(fx.store, { id: a.id, actor: 't', at: at(), reason: 'found a miss' });
    assert.equal(queryWork(fx.store, { status: 'open' }).items.some((w) => w.id === 'w-a'), true);
  } finally {
    fx.cleanup();
  }
});

test('ready selection ignores historical items and terminal blockers', () => {
  const fx = freshStore();
  try {
    const at = clock();
    const done = createWork(fx.store, { id: 'w-old', kind: 'task', title: 'Old', description: 'done', at: at() });
    const now = at();
    const claimed = claimWork(fx.store, { id: done.id, owner: 's1', until: new Date(Date.parse(now) + 60_000).toISOString(), now });
    completeWork(fx.store, { id: done.id, owner: 's1', token: claimed.claimToken!, at: at() });
    const open = createWork(fx.store, { id: 'w-new', kind: 'task', title: 'New', description: 'open', at: at() });
    addWorkDependency(fx.store, { id: 'd-hist', fromId: open.id, toId: done.id, kind: 'blocks', at: at() });
    assert.deepEqual(listReady(fx.store, at()).map((w) => w.id), ['w-new']);
  } finally {
    fx.cleanup();
  }
});

test('cycles are refused and expected revisions fence updates', () => {
  const fx = freshStore();
  try {
    const at = clock();
    createWork(fx.store, { id: 'w1', kind: 'task', title: '1', description: '1', at: at() });
    createWork(fx.store, { id: 'w2', kind: 'task', title: '2', description: '2', at: at() });
    addWorkDependency(fx.store, { id: 'd1', fromId: 'w1', toId: 'w2', kind: 'blocks', at: at() });
    assert.throws(() => addWorkDependency(fx.store, { id: 'd2', fromId: 'w2', toId: 'w1', kind: 'blocks', at: at() }), /cycle/);
    assert.throws(() => updateWork(fx.store, { id: 'w1', expectedRevision: 99, at: at(), title: 'nope' }), /expected 99/);
  } finally {
    fx.cleanup();
  }
});

test('export and restore keep durable work and drop live leases', () => {
  const fx = freshStore();
  const other = freshStore();
  try {
    const at = clock();
    createWork(fx.store, { id: 'w-keep', kind: 'outcome', title: 'Keep', description: 'Keep', at: at() });
    const now = at();
    claimWork(fx.store, { id: 'w-keep', owner: 's1', until: new Date(Date.parse(now) + 60_000).toISOString(), now });
    const dump = exportWork(fx.store, at(), 'proj-1');
    const report = restoreWork(other.store, dump, at());
    assert.equal(report.imported, 1);
    const page = queryWork(other.store, {});
    assert.equal(page.items[0]?.status, 'open');
    assert.equal(page.items[0]?.claimToken, null);
    const again = restoreWork(other.store, dump, at());
    assert.equal(again.imported, 0);
    assert.equal(again.skipped, 1);
  } finally {
    fx.cleanup();
    other.cleanup();
  }
});
