/**
 * tests/kernel/state/admission.test.ts — governing statements become live
 * graph objects; notes do not; work is admitted only with a parent.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admitWork, bindGoverningStatement, implicationsOf, supersedeGoverning } from '../../../src/kernel/state/admission.ts';
import { addClaim, addEntity, addRelation, findEntityByRef, listEntities, listRelations, setEntityStatus, supersedeClaim } from '../../../src/kernel/state/graph.ts';
import { addStatement, listStatements } from '../../../src/kernel/state/profile.ts';
import { recordObservation, listObservations } from '../../../src/kernel/state/drift.ts';
import { detectDrift } from '../../../src/kernel/drift/detect.ts';
import { freshStore } from './support.ts';

const AT = '2026-09-12T12:00:00.000Z';
const later = '2026-09-13T12:00:00.000Z';

test('a governing statement mints an entity; a note does not', () => {
  const fx = freshStore();
  try {
    let n = 0;
    const nextId = (p: string) => `${p}-${String(++n)}`;
    const decision = addStatement(fx.store, { id: 'st-d', kind: 'decision', text: 'One database', provenance: 'user', at: AT });
    const note = addStatement(fx.store, { id: 'st-n', kind: 'note', text: 'look at invoices later', provenance: 'user', at: AT });
    const entity = bindGoverningStatement(fx.store, decision, AT, nextId);
    assert.equal(entity?.kind, 'decision');
    assert.equal(entity?.externalRef, 'statement:st-d');
    assert.equal(bindGoverningStatement(fx.store, note, AT, nextId), null);
    assert.equal(findEntityByRef(fx.store, 'decision', 'statement:st-n'), null);
    assert.equal(listEntities(fx.store, { kind: 'decision' }).length, 1);
  } finally {
    fx.cleanup();
  }
});

test('supersession preserves history; new work follows the successor', () => {
  const fx = freshStore();
  try {
    let n = 0;
    const nextId = (p: string) => `${p}-${String(++n)}`;
    const older = addStatement(fx.store, { id: 'st-old', kind: 'decision', text: 'Shared database', provenance: 'user', at: AT });
    bindGoverningStatement(fx.store, older, AT, nextId);
    const newer = addStatement(fx.store, { id: 'st-new', kind: 'decision', text: 'Separate databases', provenance: 'user', at: later });
    const successor = supersedeGoverning(fx.store, { olderId: older.id, successor: newer, at: later, nextId })!;
    assert.equal(listStatements(fx.store).find((s) => s.id === older.id)?.status, 'superseded');
    assert.equal(findEntityByRef(fx.store, 'decision', 'statement:st-old')?.status, 'superseded');
    assert.equal(successor.status, 'active');
    assert.ok(listRelations(fx.store).some((r) => r.kind === 'supersedes' && r.fromId === successor.id));
    const work = admitWork(fx.store, { id: 'w-1', name: 'Split billing db', parentId: successor.id, relationId: nextId('rel'), at: later });
    assert.equal(listRelations(fx.store, { fromId: work.id, kind: 'implements' })[0]!.toId, successor.id);
  } finally {
    fx.cleanup();
  }
});

test('a superseded assumption surfaces the decision and dependents', () => {
  const fx = freshStore();
  try {
    let n = 0;
    const nextId = (p: string) => `${p}-${String(++n)}`;
    const st = addStatement(fx.store, { id: 'st-d', kind: 'decision', text: 'Share one database', provenance: 'user', at: AT });
    const decision = bindGoverningStatement(fx.store, st, AT, nextId)!;
    const assumption = addClaim(fx.store, {
      id: 'c-a',
      subjectId: decision.id,
      claimType: 'assumption',
      statement: 'billing and identity can share a schema',
      provenance: 'user',
      authority: 'authoritative',
      sensitivity: 'internal',
      confidence: 1,
      observedAt: AT,
      at: AT,
    });
    addEntity(fx.store, { id: 'code-1', kind: 'code_component', name: 'billing.ts', at: AT });
    addRelation(fx.store, { id: 'r-g', kind: 'governs', fromId: decision.id, toId: 'code-1', basis: 'declared', confidence: 1, confirmed: true, at: AT });
    const evidence = addClaim(fx.store, {
      id: 'c-e',
      subjectId: decision.id,
      claimType: 'fact',
      statement: 'identity requires a separate store',
      provenance: 'source',
      authority: 'authoritative',
      sensitivity: 'internal',
      confidence: 0.9,
      observedAt: later,
      at: later,
    });
    supersedeClaim(fx.store, { id: assumption.id, by: evidence.id, at: later });
    const found = detectDrift(fx.store, { at: later });
    const stale = found.find((f) => f.kind === 'stale_dependent_claims');
    assert.ok(stale);
    assert.match(stale!.summary, /superseded assumption/);
    assert.ok(stale!.affected.includes(`entity:${decision.id}`));
    assert.ok(stale!.affected.includes('entity:code-1'));
    assert.ok(implicationsOf(fx.store, decision.id).some((e) => e.id === 'code-1'));
  } finally {
    fx.cleanup();
  }
});

test('observations are not work; work without a parent is refused; superseded parent leaves work without a goal', () => {
  const fx = freshStore();
  try {
    let n = 0;
    const nextId = (p: string) => `${p}-${String(++n)}`;
    recordObservation(fx.store, { id: 'o-1', kind: 'risk', summary: 'the cache may stampede', at: AT });
    recordObservation(fx.store, { id: 'o-2', kind: 'unknown', summary: 'we do not know peak QPS', at: AT });
    recordObservation(fx.store, { id: 'o-3', kind: 'candidate', summary: 'could shard later', at: AT });
    assert.equal(listObservations(fx.store).length, 3);
    assert.equal(listEntities(fx.store, { kind: 'work_item' }).length, 0);
    assert.throws(() => admitWork(fx.store, { id: 'w-x', name: 'orphan', parentId: 'missing', relationId: 'r-x', at: AT }), /no parent/);
    const st = addStatement(fx.store, { id: 'st-d', kind: 'decision', text: 'Keep the cache', provenance: 'user', at: AT });
    const parent = bindGoverningStatement(fx.store, st, AT, nextId)!;
    const work = admitWork(fx.store, { id: 'w-1', name: 'Tune the cache', parentId: parent.id, relationId: nextId('rel'), at: AT });
    assert.equal(detectDrift(fx.store, { at: AT }).filter((f) => f.kind === 'work_without_goal').length, 0);
    setEntityStatus(fx.store, parent.id, 'superseded', later);
    const lost = detectDrift(fx.store, { at: later }).find((f) => f.kind === 'work_without_goal');
    assert.ok(lost);
    assert.match(lost!.summary, /Tune the cache/);
    assert.equal(work.status, 'active');
  } finally {
    fx.cleanup();
  }
});
