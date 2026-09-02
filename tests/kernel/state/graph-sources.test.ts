/**
 * tests/kernel/state/graph-sources.test.ts — relations are typed, claims carry
 * provenance and never confirm themselves, sources are authoritative per claim
 * type, snapshots dedupe by digest.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addEntity, findEntityByRef, addRelation, listRelations, setRelationStatus, InvalidRelationError,
  addClaim, confirmClaim, supersedeClaim, staleClaims, listClaims, RELATION_ENDPOINTS, RELATION_KINDS, ENTITY_KINDS,
} from '../../../src/kernel/state/graph.ts';
import {
  addSource, authorityOf, isAuthoritativeFor, recordSnapshot, latestSnapshot, freshnessOf, retireSource, setReachability,
} from '../../../src/kernel/state/sources.ts';
import { IllegalTransitionError } from '../../../src/kernel/state/rows.ts';
import { freshStore, clock } from './support.ts';

test('relations are refused between kinds that make no sense', () => {
  const fx = freshStore();
  try {
    const at = clock();
    addEntity(fx.store, { id: 'p', kind: 'person', name: 'Ada', at: at() });
    addEntity(fx.store, { id: 'team', kind: 'team', name: 'Platform', at: at() });
    addEntity(fx.store, { id: 'doc', kind: 'artifact', name: 'Design principles', at: at() });
    addEntity(fx.store, { id: 'code', kind: 'code_component', name: 'kernel/state', at: at() });
    addEntity(fx.store, { id: 'req', kind: 'requirement', name: 'One database', at: at() });
    addEntity(fx.store, { id: 't', kind: 'test', name: 'format.test', at: at() });

    // Sensible ones.
    addRelation(fx.store, { id: 'r1', kind: 'governs', fromId: 'doc', toId: 'code', basis: 'declared', confidence: 1, confirmed: true, at: at() });
    addRelation(fx.store, { id: 'r2', kind: 'implements', fromId: 'code', toId: 'req', basis: 'declared', confidence: 1, at: at() });
    addRelation(fx.store, { id: 'r3', kind: 'verifies', fromId: 't', toId: 'req', basis: 'formal', confidence: 1, at: at() });
    addRelation(fx.store, { id: 'r4', kind: 'owned_by', fromId: 'code', toId: 'team', basis: 'declared', confidence: 1, at: at() });

    // Nonsense.
    assert.throws(() => addRelation(fx.store, { id: 'x1', kind: 'owned_by', fromId: 'p', toId: 'team', basis: 'declared', confidence: 1, at: at() }), InvalidRelationError);
    assert.throws(() => addRelation(fx.store, { id: 'x2', kind: 'verifies', fromId: 'p', toId: 'req', basis: 'declared', confidence: 1, at: at() }), InvalidRelationError);
    assert.throws(() => addRelation(fx.store, { id: 'x3', kind: 'owned_by', fromId: 'code', toId: 'doc', basis: 'declared', confidence: 1, at: at() }), InvalidRelationError);
    assert.throws(() => addRelation(fx.store, { id: 'x4', kind: 'supersedes', fromId: 'doc', toId: 'code', basis: 'declared', confidence: 1, at: at() }), /one kind/);
    assert.throws(() => addRelation(fx.store, { id: 'x5', kind: 'depends_on', fromId: 'code', toId: 'code', basis: 'declared', confidence: 1, at: at() }), /itself/);
    assert.throws(() => addRelation(fx.store, { id: 'x6', kind: 'governs', fromId: 'doc', toId: 'missing', basis: 'declared', confidence: 1, at: at() }), /no entity/);
    assert.throws(() => addRelation(fx.store, { id: 'x7', kind: 'governs', fromId: 'doc', toId: 'code', basis: 'declared', confidence: 1.5, at: at() }), /between 0 and 1/);
    // Duplicate edge refused.
    assert.throws(() => addRelation(fx.store, { id: 'x8', kind: 'governs', fromId: 'doc', toId: 'code', basis: 'declared', confidence: 1, at: at() }), /UNIQUE/);

    assert.equal(listRelations(fx.store, { toId: 'req' }).length, 2);
    for (const kind of RELATION_KINDS) {
      const rule = RELATION_ENDPOINTS[kind];
      assert.ok(rule.from.length > 0 && rule.to.length > 0, `${kind} has endpoints`);
      for (const k of [...rule.from, ...rule.to]) assert.ok((ENTITY_KINDS as readonly string[]).includes(k));
    }
  } finally {
    fx.cleanup();
  }
});

test('observed or inferred ownership is proposed and cannot be confirmed at creation', () => {
  const fx = freshStore();
  try {
    const at = clock();
    addEntity(fx.store, { id: 'p', kind: 'person', name: 'Ada', at: at() });
    addEntity(fx.store, { id: 'svc', kind: 'system', name: 'billing', externalRef: 'svc:billing', at: at() });
    assert.throws(
      () => addRelation(fx.store, { id: 'o1', kind: 'owned_by', fromId: 'svc', toId: 'p', basis: 'observed', confidence: 0.7, confirmed: true, at: at() }),
      /proposed, not confirmed/,
    );
    const proposed = addRelation(fx.store, { id: 'o1', kind: 'owned_by', fromId: 'svc', toId: 'p', basis: 'observed', confidence: 0.7, at: at() });
    assert.equal(proposed.status, 'proposed');
    assert.equal(setRelationStatus(fx.store, 'o1', 'confirmed').status, 'confirmed');
    assert.equal(findEntityByRef(fx.store, 'system', 'svc:billing')?.id, 'svc');
    assert.throws(() => addEntity(fx.store, { id: 'svc2', kind: 'system', name: 'billing again', externalRef: 'svc:billing', at: at() }), /UNIQUE/);
  } finally {
    fx.cleanup();
  }
});

test('claims start from their provenance and move only forward', () => {
  const fx = freshStore();
  try {
    const at = clock();
    addEntity(fx.store, { id: 'team', kind: 'team', name: 'Platform', at: at() });
    const common = { subjectId: 'team', claimType: 'headcount', authority: 'informative' as const, sensitivity: 'internal' as const, confidence: 0.8, observedAt: at() };
    const observed = addClaim(fx.store, { ...common, id: 'c-src', statement: 'Platform has 6 people', provenance: 'source', at: at() });
    const inferred = addClaim(fx.store, { ...common, id: 'c-inf', statement: 'Platform has 5 people', provenance: 'discovery', at: at() });
    const confirmed = addClaim(fx.store, { ...common, id: 'c-user', statement: 'Platform has 6 people', provenance: 'user', at: at() });
    assert.equal(observed.status, 'observed');
    assert.equal(inferred.status, 'inferred');
    assert.equal(confirmed.status, 'confirmed');
    assert.equal(confirmClaim(fx.store, 'c-src', at()).status, 'confirmed');
    assert.throws(() => confirmClaim(fx.store, 'c-src', at()), IllegalTransitionError);
    const superseded = supersedeClaim(fx.store, { id: 'c-inf', by: 'c-user', at: at() });
    assert.equal(superseded.status, 'superseded');
    assert.equal(superseded.supersededBy, 'c-user');
    assert.throws(() => supersedeClaim(fx.store, { id: 'c-user', by: 'nope', at: at() }), /no claim nope/);
    assert.equal(listClaims(fx.store, { subjectId: 'team', status: 'superseded' }).length, 1);
  } finally {
    fx.cleanup();
  }
});

test('stale claims are the live ones past their freshness', () => {
  const fx = freshStore();
  try {
    const at = clock();
    addEntity(fx.store, { id: 'init', kind: 'initiative', name: 'Q1 launch', at: at() });
    addClaim(fx.store, { id: 'fresh', subjectId: 'init', claimType: 'owner', statement: 'owned by Ada', provenance: 'source', authority: 'authoritative', sensitivity: 'internal', confidence: 1, observedAt: at(), freshUntil: '2026-12-01T00:00:00.000Z', at: at() });
    addClaim(fx.store, { id: 'old', subjectId: 'init', claimType: 'owner', statement: 'owned by Bob', provenance: 'source', authority: 'authoritative', sensitivity: 'internal', confidence: 1, observedAt: at(), freshUntil: '2026-09-01T00:00:00.000Z', at: at() });
    addClaim(fx.store, { id: 'forever', subjectId: 'init', claimType: 'purpose', statement: 'ship', provenance: 'user', authority: 'authoritative', sensitivity: 'internal', confidence: 1, observedAt: at(), at: at() });
    assert.deepEqual(staleClaims(fx.store, '2026-09-02T00:00:00.000Z').map((c) => c.id), ['old']);
    supersedeClaim(fx.store, { id: 'old', by: 'fresh', at: at() });
    assert.equal(staleClaims(fx.store, '2026-09-02T00:00:00.000Z').length, 0);
  } finally {
    fx.cleanup();
  }
});

test('a source is authoritative only for the claim types it declares', () => {
  const fx = freshStore();
  try {
    const at = clock();
    addSource(fx.store, {
      id: 'hris', kind: 'hris', purpose: 'people directory', authorityLevel: 'authoritative', sensitivity: 'confidential',
      canRead: true, canWrite: false, authoritativeFor: ['reporting_line', 'employment'], notAuthoritativeFor: ['capacity'], at: at(),
    });
    assert.deepEqual(authorityOf(fx.store, 'hris'), { authoritativeFor: ['employment', 'reporting_line'], notAuthoritativeFor: ['capacity'] });
    assert.equal(isAuthoritativeFor(fx.store, 'hris', 'reporting_line'), 'yes');
    assert.equal(isAuthoritativeFor(fx.store, 'hris', 'capacity'), 'no');
    assert.equal(isAuthoritativeFor(fx.store, 'hris', 'velocity'), 'undeclared');
    assert.throws(
      () => addSource(fx.store, { id: 'bad', kind: 'jira', purpose: 'x', authorityLevel: 'informative', sensitivity: 'internal', canRead: true, canWrite: true, authoritativeFor: ['capacity'], notAuthoritativeFor: ['capacity'], at: at() }),
      /both authoritative and not/,
    );
    assert.equal(isAuthoritativeFor(fx.store, 'bad', 'capacity'), 'undeclared');
  } finally {
    fx.cleanup();
  }
});

test('snapshots dedupe by digest and drive freshness', () => {
  const fx = freshStore();
  try {
    addSource(fx.store, { id: 'docs', kind: 'docs', purpose: 'design docs', authorityLevel: 'authoritative', freshnessHours: 24, sensitivity: 'internal', canRead: true, canWrite: false, at: '2026-09-01T00:00:00.000Z' });
    assert.equal(freshnessOf(fx.store, 'docs', '2026-09-01T00:00:00.000Z'), 'never_read');
    const first = recordSnapshot(fx.store, { id: 'snap-1', sourceId: 'docs', digest: 'abc', at: '2026-09-01T01:00:00.000Z' });
    assert.equal(first.changed, true);
    const same = recordSnapshot(fx.store, { id: 'snap-2', sourceId: 'docs', digest: 'abc', at: '2026-09-01T02:00:00.000Z' });
    assert.equal(same.changed, false);
    assert.equal(same.snapshot.id, 'snap-1');
    assert.equal(latestSnapshot(fx.store, 'docs')?.id, 'snap-1');
    assert.equal(freshnessOf(fx.store, 'docs', '2026-09-01T12:00:00.000Z'), 'fresh');
    assert.equal(freshnessOf(fx.store, 'docs', '2026-09-03T00:00:00.000Z'), 'stale');
    const changed = recordSnapshot(fx.store, { id: 'snap-3', sourceId: 'docs', digest: 'def', at: '2026-09-03T00:00:00.000Z' });
    assert.equal(changed.changed, true);
    assert.equal(freshnessOf(fx.store, 'docs', '2026-09-03T01:00:00.000Z'), 'fresh');

    setReachability(fx.store, 'docs', 'unreachable', '2026-09-03T02:00:00.000Z');
    const retired = retireSource(fx.store, 'docs', '2026-09-03T03:00:00.000Z');
    assert.equal(retired.status, 'retired');
    assert.throws(() => retireSource(fx.store, 'docs', '2026-09-03T04:00:00.000Z'), /no active source/);
    assert.throws(() => recordSnapshot(fx.store, { id: 'snap-x', sourceId: 'missing', digest: 'zzz', at: '2026-09-03T00:00:00.000Z' }), /FOREIGN KEY|no source/);
  } finally {
    fx.cleanup();
  }
});
