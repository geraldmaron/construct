/**
 * tests/kernel/source/authority-identity-org.test.ts — authority is per claim
 * type and fresh; identities never merge while ambiguous; org relations from
 * sources are proposals until a person confirms them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addSource, recordSnapshot } from '../../../src/kernel/state/sources.ts';
import { addEntity, listClaims, listRelations } from '../../../src/kernel/state/graph.ts';
import { authorityVerdict, recordClaimFromSource, mostRestrictive, authoritativeSourcesFor } from '../../../src/kernel/source/authority.ts';
import { resolveIdentity, admitIdentity, AmbiguousIdentityError } from '../../../src/kernel/source/identity.ts';
import { proposeOrgRelation, confirmOrgRelation, orgView, confirmedOwners, retireOrgRelation } from '../../../src/kernel/source/org.ts';
import { addRelation, InvalidRelationError } from '../../../src/kernel/state/graph.ts';
import { freshStore, clock } from '../state/support.ts';

const T = '2026-09-02T10:00:00.000Z';

function seed(store: ReturnType<typeof freshStore>['store']): void {
  addSource(store, { id: 'hris', kind: 'hris', purpose: 'people', authorityLevel: 'authoritative', sensitivity: 'confidential', freshnessHours: 24, canRead: true, canWrite: false, authoritativeFor: ['reporting_line', 'headcount'], notAuthoritativeFor: ['capacity'], at: T });
  addSource(store, { id: 'jira', kind: 'jira', purpose: 'work', authorityLevel: 'authoritative', sensitivity: 'internal', canRead: true, canWrite: true, authoritativeFor: ['work_item'], notAuthoritativeFor: ['capacity'], at: T });
  addSource(store, { id: 'gossip', kind: 'other', purpose: 'hallway', authorityLevel: 'untrusted', sensitivity: 'public', canRead: true, canWrite: false, at: T });
  addEntity(store, { id: 'team-a', kind: 'team', name: 'Platform', at: T });
}

test('a claim from a source inherits its authority for that type and at least its sensitivity', () => {
  const fx = freshStore();
  try {
    seed(fx.store);
    const head = recordClaimFromSource(fx.store, { id: 'c1', sourceId: 'hris', subjectId: 'team-a', claimType: 'headcount', statement: '6 people', value: 6, confidence: 0.95, sensitivity: 'public', observedAt: T, defaultFreshnessHours: 168, at: T });
    assert.equal(head.authority, 'authoritative');
    assert.equal(head.sensitivity, 'confidential');
    assert.equal(head.status, 'observed');
    assert.equal(head.freshUntil, '2026-09-03T10:00:00.000Z');
    const cap = recordClaimFromSource(fx.store, { id: 'c2', sourceId: 'jira', subjectId: 'team-a', claimType: 'capacity', statement: 'velocity 40', confidence: 0.7, observedAt: T, defaultFreshnessHours: 168, at: T });
    assert.equal(cap.authority, 'informative');
    assert.equal(cap.freshUntil, '2026-09-09T10:00:00.000Z');
    const rumor = recordClaimFromSource(fx.store, { id: 'c3', sourceId: 'gossip', subjectId: 'team-a', claimType: 'headcount', statement: '12 people', confidence: 0.2, observedAt: T, defaultFreshnessHours: 1, at: T });
    assert.equal(rumor.authority, 'untrusted');
    assert.equal(mostRestrictive('internal', 'restricted'), 'restricted');
    assert.deepEqual(authoritativeSourcesFor(fx.store, 'headcount').map((s) => s.id), ['hris']);
    assert.deepEqual(authoritativeSourcesFor(fx.store, 'capacity'), []);
  } finally {
    fx.cleanup();
  }
});

test('a conclusion is settled only by a fresh, authoritative source or a confirmed person', () => {
  const fx = freshStore();
  try {
    seed(fx.store);
    recordClaimFromSource(fx.store, { id: 'c1', sourceId: 'hris', subjectId: 'team-a', claimType: 'headcount', statement: '6', confidence: 1, observedAt: T, defaultFreshnessHours: 168, at: T });
    recordClaimFromSource(fx.store, { id: 'c2', sourceId: 'jira', subjectId: 'team-a', claimType: 'capacity', statement: 'velocity 40', confidence: 1, observedAt: T, defaultFreshnessHours: 168, at: T });
    const claims = listClaims(fx.store, { subjectId: 'team-a' });

    // Unread source: not sufficient, and says so.
    let v = authorityVerdict(fx.store, { claimType: 'headcount', claims, at: T });
    assert.equal(v.sufficient, false);
    assert.deepEqual(v.reasons, ['source hris is unread']);

    recordSnapshot(fx.store, { id: 's1', sourceId: 'hris', digest: 'x', at: T });
    v = authorityVerdict(fx.store, { claimType: 'headcount', claims, at: '2026-09-02T12:00:00.000Z' });
    assert.equal(v.sufficient, true);
    assert.deepEqual(v.supporting.map((c) => c.id), ['c1']);

    // Stale source: no longer sufficient.
    v = authorityVerdict(fx.store, { claimType: 'headcount', claims, at: '2026-09-05T00:00:00.000Z' });
    assert.equal(v.sufficient, false);
    assert.deepEqual(v.reasons, ['source hris is stale']);

    // Velocity as capacity: refused with the reason.
    v = authorityVerdict(fx.store, { claimType: 'capacity', claims, at: T });
    assert.equal(v.sufficient, false);
    assert.deepEqual(v.reasons, ['source jira is declared not authoritative for capacity']);
    assert.deepEqual(authorityVerdict(fx.store, { claimType: 'budget', claims, at: T }).reasons, ['no live claim of type budget']);
  } finally {
    fx.cleanup();
  }
});

test('identity resolves by reference, then email, then name, and never merges while ambiguous', () => {
  const fx = freshStore();
  try {
    seed(fx.store);
    let n = 0;
    const nextId = (p: string) => `${p}-${String(++n)}`;
    const ada = { kind: 'person' as const, sourceId: 'hris', externalRef: 'E100', name: 'Ada Lovelace', email: 'Ada@Acme.com' };
    assert.equal(resolveIdentity(fx.store, ada).outcome, 'new');
    const created = admitIdentity(fx.store, { candidate: ada, at: T, nextId });
    assert.equal(created.created, true);
    assert.equal(resolveIdentity(fx.store, ada).outcome, 'match');

    // Jira knows her by a different ref but the same email: matched, alias recorded, nothing created.
    const jiraAda = { kind: 'person' as const, sourceId: 'jira', externalRef: 'alovelace', name: 'A. Lovelace', email: 'ada@acme.com' };
    const r = resolveIdentity(fx.store, jiraAda);
    assert.equal(r.outcome, 'match');
    assert.equal(r.outcome === 'match' && r.by, 'email');
    const linked = admitIdentity(fx.store, { candidate: jiraAda, at: T, nextId });
    assert.equal(linked.created, false);
    assert.equal(linked.entity.id, created.entity.id);
    assert.equal(listClaims(fx.store, { claimType: 'identity_alias' }).length, 1);
    const viaAlias = resolveIdentity(fx.store, jiraAda);
    assert.equal(viaAlias.outcome === 'match' && viaAlias.by, 'alias');

    // Two people with the same name and no email: ambiguous, refused until chosen.
    addEntity(fx.store, { id: 'p-1', kind: 'person', name: 'Sam Lee', at: T });
    addEntity(fx.store, { id: 'p-2', kind: 'person', name: 'Sam Lee', at: T });
    const sam = { kind: 'person' as const, sourceId: 'jira', externalRef: 'slee', name: 'sam lee' };
    const amb = resolveIdentity(fx.store, sam);
    assert.equal(amb.outcome, 'ambiguous');
    assert.throws(() => admitIdentity(fx.store, { candidate: sam, at: T, nextId }), AmbiguousIdentityError);
    assert.throws(() => admitIdentity(fx.store, { candidate: sam, at: T, nextId, chosenEntityId: 'p-9' }), AmbiguousIdentityError);
    const chosen = admitIdentity(fx.store, { candidate: sam, at: T, nextId, chosenEntityId: 'p-2' });
    assert.equal(chosen.entity.id, 'p-2');
    assert.equal(chosen.created, false);
  } finally {
    fx.cleanup();
  }
});

test('ownership, reporting lines, and membership from a source are proposals a person confirms', () => {
  const fx = freshStore();
  try {
    seed(fx.store);
    addEntity(fx.store, { id: 'ada', kind: 'person', name: 'Ada', at: T });
    addEntity(fx.store, { id: 'grace', kind: 'person', name: 'Grace', at: T });
    addEntity(fx.store, { id: 'svc', kind: 'system', name: 'billing', at: T });
    addEntity(fx.store, { id: 'init', kind: 'initiative', name: 'Q4 billing rewrite', at: T });

    // Even a formal HRIS reporting line cannot arrive confirmed.
    assert.throws(
      () => addRelation(fx.store, { id: 'x', kind: 'reports_to', fromId: 'ada', toId: 'grace', basis: 'formal', confidence: 1, sourceId: 'hris', confirmed: true, at: T }),
      InvalidRelationError,
    );
    const reports = proposeOrgRelation(fx.store, { id: 'r1', kind: 'reports_to', fromId: 'ada', toId: 'grace', basis: 'formal', confidence: 1, sourceId: 'hris', at: T });
    const member = proposeOrgRelation(fx.store, { id: 'r2', kind: 'member_of', fromId: 'ada', toId: 'team-a', basis: 'formal', confidence: 1, sourceId: 'hris', at: T });
    const owns = proposeOrgRelation(fx.store, { id: 'r3', kind: 'owned_by', fromId: 'svc', toId: 'team-a', basis: 'declared', confidence: 0.9, sourceId: 'jira', at: T });
    const reviews = proposeOrgRelation(fx.store, { id: 'r4', kind: 'contributes_to', fromId: 'grace', toId: 'init', basis: 'observed', confidence: 0.5, sourceId: 'jira', at: T });
    for (const r of [reports, member, owns, reviews]) assert.equal(r.status, 'proposed');
    assert.throws(() => proposeOrgRelation(fx.store, { id: 'x', kind: 'member_of', fromId: 'svc', toId: 'team-a', basis: 'formal', confidence: 1, sourceId: 'hris', at: T }), InvalidRelationError);

    const view = orgView(fx.store, 'ada');
    assert.deepEqual(view.formal.map((r) => r.kind), ['reports_to', 'member_of']);
    assert.deepEqual(view.awaitingConfirmation.map((r) => r.id), ['r1', 'r2']);
    assert.deepEqual(orgView(fx.store, 'init').observed.map((r) => r.id), ['r4']);
    assert.deepEqual(orgView(fx.store, 'init').awaitingConfirmation, []);
    assert.deepEqual(confirmedOwners(fx.store, 'svc'), []);

    confirmOrgRelation(fx.store, { id: 'r3', by: 'gerald', at: T });
    assert.deepEqual(confirmedOwners(fx.store, 'svc').map((r) => r.id), ['r3']);
    retireOrgRelation(fx.store, { id: 'r1', by: 'gerald', at: T });
    assert.deepEqual(orgView(fx.store, 'ada').awaitingConfirmation.map((r) => r.id), ['r2']);
    assert.equal(listRelations(fx.store, { status: 'retired' }).length, 1);
  } finally {
    fx.cleanup();
  }
});
