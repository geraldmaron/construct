import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, clock } from '../state/support.ts';
import { addWorkDependency, cancelWork, claimWork, completeWork, createWork, exportWork, getWork, restoreWork, supersedeWork } from '../../../src/kernel/work/service.ts';
import { addEntity, getEntity } from '../../../src/kernel/state/graph.ts';
import { admitProposedWork, fileWork, linkWork, workStructure } from '../../../src/kernel/work/structure.ts';

test('completion enforces admission, unfinished dependencies, blocked and stale premises without requiring a relay claim', () => {
  const fx = freshStore();
  try {
    const at = clock();
    let n = 0;
    const nextId = () => `ledger-regression-${++n}`;
    const blocker = fileWork(fx.store, { id: 'blocker', kind: 'task', title: 'Prerequisite', byPerson: true, at: at(), nextId }).work;
    const dependent = fileWork(fx.store, { id: 'dependent', kind: 'task', title: 'Dependent', blockedBy: [blocker.id], byPerson: false, at: at(), nextId }).work;
    assert.throws(() => completeWork(fx.store, { id: dependent.id, owner: 'relay', at: at() }), /not admitted/);
    assert.equal(getWork(fx.store, dependent.id)!.status, 'proposed');
    admitProposedWork(fx.store, { id: dependent.id, actor: 'person', byPerson: true, at: at() });
    assert.throws(() => completeWork(fx.store, { id: dependent.id, owner: 'relay', at: at() }), /blocked by blocker/);
    completeWork(fx.store, { id: blocker.id, owner: 'relay', at: at() });
    assert.equal(completeWork(fx.store, { id: dependent.id, owner: 'relay', at: at() }).status, 'completed');
    createWork(fx.store, { id: 'held', kind: 'task', title: 'Held', description: '', status: 'blocked', at: at() });
    assert.throws(() => completeWork(fx.store, { id: 'held', owner: 'relay', at: at() }), /blocked/);
    createWork(fx.store, { id: 'stale', kind: 'task', title: 'Stale', description: '', premises: { stale: true }, at: at() });
    assert.throws(() => completeWork(fx.store, { id: 'stale', owner: 'relay', at: at() }), /requalify/);
    assert.equal(cancelWork(fx.store, { id: 'held', actor: 'relay', at: at(), reason: 'No longer needed' }).status, 'cancelled');
    const proposed = fileWork(fx.store, { id: 'discard', kind: 'task', title: 'Discard', byPerson: false, at: at(), nextId }).work;
    assert.equal(cancelWork(fx.store, { id: proposed.id, actor: 'relay', at: at(), reason: 'Declined' }).status, 'cancelled');
    createWork(fx.store, { id: 'claimed', kind: 'task', title: 'Claimed', description: '', at: at() });
    const now = at();
    const claim = claimWork(fx.store, { id: 'claimed', owner: 'agent', now, until: new Date(Date.parse(now) + 60_000).toISOString() });
    assert.throws(() => completeWork(fx.store, { id: 'claimed', owner: 'relay', at: at() }), /held by agent/);
    assert.equal(completeWork(fx.store, { id: 'claimed', owner: 'agent', token: claim.claimToken!, at: at() }).status, 'completed');
  } finally { fx.cleanup(); }
});

test('restore resolves later-created parents and successors, preserves events, and remains idempotent', () => {
  const fx = freshStore();
  const other = freshStore();
  try {
    const at = clock();
    let n = 0;
    const nextId = () => `restore-regression-${++n}`;
    fileWork(fx.store, { id: 'child', kind: 'task', title: 'Older child', byPerson: false, at: at(), nextId });
    fileWork(fx.store, { id: 'parent', kind: 'outcome', title: 'Newer parent', byPerson: true, at: at(), nextId });
    linkWork(fx.store, { id: 'child', parentId: 'parent', at: at(), nextId });
    createWork(fx.store, { id: 'old', kind: 'task', title: 'Old', description: '', at: at() });
    createWork(fx.store, { id: 'successor', kind: 'task', title: 'Successor', description: '', at: at() });
    supersedeWork(fx.store, { id: 'old', successorId: 'successor', actor: 'person', reason: 'Replaced', at: at() });
    addWorkDependency(fx.store, { id: 'dep', fromId: 'child', toId: 'successor', kind: 'blocks', at: at() });
    const dump = exportWork(fx.store, at(), 'project');
    assert.equal(restoreWork(other.store, dump, at(), 'project').imported, 4);
    assert.equal(getWork(other.store, 'child')!.parentId, 'parent');
    assert.equal(getWork(other.store, 'old')!.supersededBy, 'successor');
    assert.equal(workStructure(other.store, getWork(other.store, 'parent')!).admittedBy, 'person');
    assert.equal(workStructure(other.store, getWork(other.store, 'child')!).blockedBy[0]!.id, 'successor');
    const events = other.store.db.prepare('SELECT COUNT(*) AS n FROM work_events').get()!.n;
    assert.equal(events, dump.events.length);
    assert.equal(restoreWork(other.store, dump, at(), 'project').skipped, 4);
    assert.equal(other.store.db.prepare('SELECT COUNT(*) AS n FROM work_events').get()!.n, events);
  } finally { fx.cleanup(); other.cleanup(); }
});

test('restore rolls back all identities on an unresolved relationship', () => {
  const fx = freshStore();
  const other = freshStore();
  try {
    const at = clock();
    createWork(fx.store, { id: 'first', kind: 'task', title: 'First', description: '', at: at() });
    createWork(fx.store, { id: 'second', kind: 'task', title: 'Second', description: '', at: at() });
    const dump = exportWork(fx.store, at(), null);
    const broken = { ...dump, work: dump.work.map((row) => ({ ...(row as Record<string, unknown>), parent_id: 'missing' })) };
    assert.throws(() => restoreWork(other.store, broken, at()), /FOREIGN KEY/);
    assert.equal(other.store.db.prepare('SELECT COUNT(*) AS n FROM work_items').get()!.n, 0);
  } finally { fx.cleanup(); other.cleanup(); }
});

test('restore refuses snapshot parent and dependency cycles atomically', () => {
  const fx = freshStore();
  const other = freshStore();
  try {
    const at = clock();
    for (const id of ['one', 'two']) createWork(fx.store, { id, kind: 'task', title: id, description: '', at: at() });
    const dump = exportWork(fx.store, at(), null);
    const parentCycle = { ...dump, work: dump.work.map((raw) => { const row = raw as Record<string, unknown>; return { ...row, parent_id: row.id === 'one' ? 'two' : 'one' }; }) };
    assert.throws(() => restoreWork(other.store, parentCycle, at()), /cycle its parent chain/);
    assert.equal(getWork(other.store, 'one'), null);
    const dependencyCycle = { ...dump, dependencies: [
      { id: 'one-two', from_id: 'one', to_id: 'two', kind: 'blocks', created_at: at() },
      { id: 'two-one', from_id: 'two', to_id: 'one', kind: 'blocks', created_at: at() },
    ] };
    assert.throws(() => restoreWork(other.store, dependencyCycle, at()), /would cycle/);
    assert.equal(getWork(other.store, 'one'), null);
  } finally { fx.cleanup(); other.cleanup(); }
});

test('restore keeps live conflicting rows and their history while importing a child referencing them', () => {
  const fx = freshStore();
  const other = freshStore();
  try {
    const at = clock();
    createWork(fx.store, { id: 'child', kind: 'task', title: 'Child', description: '', at: at() });
    createWork(fx.store, { id: 'parent', kind: 'outcome', title: 'Snapshot parent', description: '', at: at() });
    let n = 0;
    linkWork(fx.store, { id: 'child', parentId: 'parent', at: at(), nextId: () => `merge-${++n}` });
    const dump = exportWork(fx.store, at(), null);
    createWork(other.store, { id: 'parent', kind: 'outcome', title: 'Live parent', description: '', at: at() });
    other.store.db.prepare('UPDATE work_items SET revision = revision + 1 WHERE id = ?').run('parent');
    const eventCount = other.store.db.prepare('SELECT COUNT(*) AS n FROM work_events WHERE work_id = ?').get('parent')!.n;
    const report = restoreWork(other.store, dump, at());
    assert.equal(report.imported, 1);
    assert.equal(report.skipped, 1);
    assert.equal(report.conflicts.length, 1);
    assert.equal(getWork(other.store, 'parent')!.title, 'Live parent');
    assert.equal(getWork(other.store, 'child')!.parentId, 'parent');
    assert.equal(other.store.db.prepare('SELECT COUNT(*) AS n FROM work_events WHERE work_id = ?').get('parent')!.n, eventCount);
  } finally { fx.cleanup(); other.cleanup(); }
});

test('restore strips legacy event tokens and keeps snapshot terminal states without live claims', () => {
  const fx = freshStore();
  const other = freshStore();
  try {
    const at = clock();
    createWork(fx.store, { id: 'finished', kind: 'task', title: 'Finished', description: '', at: at() });
    completeWork(fx.store, { id: 'finished', owner: 'person', at: at() });
    const dump = exportWork(fx.store, at(), null);
    const legacy = { ...dump, events: [...dump.events, { work_id: 'finished', at: at(), kind: 'claimed', actor: 'old', expected_revision: 1, payload_json: JSON.stringify({ token: 'old-secret', until: at() }) }] };
    restoreWork(other.store, legacy, at());
    const finished = getWork(other.store, 'finished')!;
    assert.equal(finished.status, 'completed');
    assert.equal(finished.claimOwner, null);
    assert.equal(finished.claimToken, null);
    const events = other.store.db.prepare('SELECT payload_json FROM work_events').all();
    assert.equal(JSON.stringify(events).includes('old-secret'), false);
  } finally { fx.cleanup(); other.cleanup(); }
});

test('a claim cannot complete after an unfinished dependency or stale premise appears', () => {
  const fx = freshStore();
  try {
    const at = clock();
    for (const id of ['claimed-late', 'prerequisite']) createWork(fx.store, { id, kind: 'task', title: id, description: '', at: at() });
    const now = at();
    const claim = claimWork(fx.store, { id: 'claimed-late', owner: 'agent', now, until: new Date(Date.parse(now) + 60_000).toISOString() });
    addWorkDependency(fx.store, { id: 'late-dependency', fromId: claim.id, toId: 'prerequisite', kind: 'blocks', at: at() });
    assert.throws(() => completeWork(fx.store, { id: claim.id, owner: 'agent', token: claim.claimToken!, at: at() }), /blocked by prerequisite/);
    completeWork(fx.store, { id: 'prerequisite', owner: 'relay', at: at() });
    fx.store.db.prepare('UPDATE work_items SET premises_json = ? WHERE id = ?').run(JSON.stringify({ stale: true }), claim.id);
    assert.throws(() => completeWork(fx.store, { id: claim.id, owner: 'agent', token: claim.claimToken!, at: at() }), /requalify/);
    assert.equal(getWork(fx.store, claim.id)!.status, 'claimed');
  } finally { fx.cleanup(); }
});

test('snapshot preserves serves graph, leaves live reason conflicts unchanged, and reports legacy omissions', () => {
  const fx = freshStore();
  const restored = freshStore();
  const merged = freshStore();
  const legacyStore = freshStore();
  try {
    const at = clock();
    let n = 0;
    const nextId = () => `reason-${++n}`;
    addEntity(fx.store, { id: 'metric', kind: 'metric', name: 'Claim latency', at: at() });
    fileWork(fx.store, { id: 'serving', kind: 'task', title: 'Improve claims', serves: 'metric', byPerson: false, at: at(), nextId });
    const dump = exportWork(fx.store, at(), 'project');
    assert.equal(dump.graph!.entities.length, 2);
    assert.equal(dump.graph!.reasons.length, 1);
    restoreWork(restored.store, dump, at(), 'project');
    const shown = workStructure(restored.store, getWork(restored.store, 'serving')!);
    assert.equal(shown.serves[0]!.id, 'metric');
    assert.equal(shown.admittedBy, 'serves');
    addEntity(merged.store, { id: 'metric', kind: 'metric', name: 'Live metric', at: at() });
    merged.store.db.prepare('UPDATE entities SET status = ? WHERE id = ?').run('retired', 'metric');
    const report = restoreWork(merged.store, dump, at(), 'project');
    assert.ok(report.conflicts.some((c) => c.includes('metric')));
    assert.equal(getEntity(merged.store, 'metric')!.status, 'retired');
    assert.equal(getEntity(merged.store, 'metric')!.name, 'Live metric');
    const { graph: _graph, ...legacy } = dump;
    const legacyReport = restoreWork(legacyStore.store, legacy, at(), 'project');
    assert.ok(legacyReport.conflicts.some((c) => c.includes('legacy snapshot has no reason graph')));
    assert.notEqual(getWork(legacyStore.store, 'serving')!.entityId, null);
    assert.equal(workStructure(legacyStore.store, getWork(legacyStore.store, 'serving')!).serves.length, 0);
  } finally { fx.cleanup(); restored.cleanup(); merged.cleanup(); legacyStore.cleanup(); }
});

test('snapshot reason validation rolls back imports and never adds edges on skipped work', () => {
  const fx = freshStore();
  const other = freshStore();
  try {
    const at = clock();
    let n = 0;
    addEntity(fx.store, { id: 'reason', kind: 'metric', name: 'Metric', at: at() });
    fileWork(fx.store, { id: 'work', kind: 'task', title: 'Work', serves: 'reason', byPerson: false, at: at(), nextId: () => `graph-${++n}` });
    const dump = exportWork(fx.store, at(), null);
    const malformed = { ...dump, graph: { ...dump.graph!, reasons: dump.graph!.reasons.map((r) => ({ ...r, kind: 'owned_by' as const })) } };
    assert.throws(() => restoreWork(other.store, malformed, at()), /only work reason relations/);
    assert.equal(getWork(other.store, 'work'), null);
    assert.equal(getEntity(other.store, 'reason'), null);
    createWork(other.store, { id: 'work', kind: 'task', title: 'Live work', description: '', at: at() });
    restoreWork(other.store, dump, at());
    assert.equal(getEntity(other.store, 'reason'), null);
    assert.equal(workStructure(other.store, getWork(other.store, 'work')!).serves.length, 0);
  } finally { fx.cleanup(); other.cleanup(); }
});

test('dependency identity collisions cannot silently drop restored blocking relationships', () => {
  const fx = freshStore();
  const other = freshStore();
  try {
    const at = clock();
    for (const id of ['child', 'blocker']) createWork(fx.store, { id, kind: 'task', title: id, description: '', at: at() });
    addWorkDependency(fx.store, { id: 'colliding-dependency', fromId: 'child', toId: 'blocker', kind: 'blocks', at: at() });
    for (const id of ['unrelated-a', 'unrelated-b']) createWork(other.store, { id, kind: 'task', title: id, description: '', at: at() });
    addWorkDependency(other.store, { id: 'colliding-dependency', fromId: 'unrelated-a', toId: 'unrelated-b', kind: 'informs', at: at() });
    assert.throws(() => restoreWork(other.store, exportWork(fx.store, at(), null), at()), /dependency colliding-dependency conflicts with its live identity/);
    assert.equal(getWork(other.store, 'child'), null);
    assert.equal(getWork(other.store, 'blocker'), null);
    assert.notEqual(getWork(other.store, 'unrelated-a'), null);
  } finally { fx.cleanup(); other.cleanup(); }
});

test('restore does not revive dependencies removed from skipped live work', () => {
  const fx = freshStore();
  try {
    const at = clock();
    for (const id of ['live', 'blocker']) createWork(fx.store, { id, kind: 'task', title: id, description: '', at: at() });
    addWorkDependency(fx.store, { id: 'removed', fromId: 'live', toId: 'blocker', kind: 'blocks', at: at() });
    const dump = exportWork(fx.store, at(), null);
    fx.store.db.prepare('DELETE FROM work_dependencies WHERE id = ?').run('removed');
    fx.store.db.prepare('UPDATE work_items SET revision = revision + 1 WHERE id = ?').run('live');
    const report = restoreWork(fx.store, dump, at());
    assert.equal(report.imported, 0);
    assert.equal(report.skipped, 2);
    assert.equal(report.conflicts.length, 1);
    assert.equal(workStructure(fx.store, getWork(fx.store, 'live')!).blockedBy.length, 0);
  } finally { fx.cleanup(); }
});
