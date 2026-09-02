/**
 * tests/kernel/drift/detect.test.ts — drift is found from relations, statuses,
 * dates, and sums, each finding cited; similar wording alone finds nothing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDrift, recordDrift } from '../../../src/kernel/drift/detect.ts';
import { addEntity, addRelation, addClaim, setEntityStatus, setRelationStatus } from '../../../src/kernel/state/graph.ts';
import { addStatement } from '../../../src/kernel/state/profile.ts';
import { addSource, recordSnapshot } from '../../../src/kernel/state/sources.ts';
import { createRun } from '../../../src/kernel/state/runs.ts';
import { listDriftFindings } from '../../../src/kernel/state/drift.ts';
import { freshStore } from '../state/support.ts';

const T0 = '2026-09-01T10:00:00.000Z';
const T1 = '2026-09-02T10:00:00.000Z';

test('a principle contradicted by an implementation is a cited finding; similar wording alone is silence', () => {
  const fx = freshStore();
  try {
    const s = fx.store;
    const principle = addStatement(s, { id: 'st-1', kind: 'principle', text: 'The kernel never touches the network', provenance: 'user', at: T0 });
    addEntity(s, { id: 'dec-1', kind: 'decision', name: 'Kernel stays offline', externalRef: `statement:${principle.id}`, at: T0 });
    addEntity(s, { id: 'code-1', kind: 'code_component', name: 'kernel/fetch.ts', at: T0 });
    addEntity(s, { id: 'test-1', kind: 'test', name: 'kernel offline test', at: T0 });
    addRelation(s, { id: 'r-impl', kind: 'implements', fromId: 'code-1', toId: 'dec-1', basis: 'declared', confidence: 1, confirmed: true, at: T0 });
    addRelation(s, { id: 'r-ver', kind: 'verifies', fromId: 'test-1', toId: 'dec-1', basis: 'formal', confidence: 1, confirmed: true, at: T0 });
    // Control: two artifacts whose names read alike, with no relation between them and nothing wrong.
    addEntity(s, { id: 'doc-a', kind: 'artifact', name: 'Network policy', at: T0 });
    addEntity(s, { id: 'doc-b', kind: 'artifact', name: 'Network policy (team B)', at: T0 });
    assert.deepEqual(detectDrift(s, { at: T1 }), [], 'nothing material changed: silence');

    addRelation(s, { id: 'r-contra', kind: 'contradicts', fromId: 'code-1', toId: 'dec-1', basis: 'observed', confidence: 0.8, sourceId: undefined, at: T1 });
    const found = detectDrift(s, { at: T1 });
    assert.equal(found.length, 1);
    assert.equal(found[0]!.kind, 'contradicts_obligation');
    assert.match(found[0]!.summary, /kernel\/fetch\.ts.*contradicts decision.*Kernel stays offline/);
    assert.deepEqual(found[0]!.affected, ['entity:dec-1', 'entity:code-1']);
    assert.equal(found[0]!.evidence[0]!.ref, 'relation:r-contra');
    assert.ok(found[0]!.repairPath.length > 10);

    createRun(s, { id: 'run-1', workflowId: 'source-drift-review', workflowVersion: '1.0.0', interactionClass: 'maintain', triggerKind: 'manual', idempotencyKey: 'k', executorKind: 'interactive', executorId: 'e', input: {}, at: T1 });
    const first = recordDrift(s, { runId: 'run-1', detected: found, at: T1, nextId: (p) => `${p}-1` });
    assert.equal(first.recorded.length, 1);
    const again = recordDrift(s, { runId: 'run-1', detected: found, at: T1, nextId: (p) => `${p}-2` });
    assert.equal(again.recorded.length, 0);
    assert.equal(again.alreadyOpen, 1);
    assert.equal(listDriftFindings(s, { status: 'open' }).length, 1);
    setRelationStatus(s, 'r-contra', 'retired');
    assert.deepEqual(detectDrift(s, { at: T1 }), []);
  } finally {
    fx.cleanup();
  }
});

test('obligations without evidence, unlinked requirements, superseded documents, and stale claims are found with their repair paths', () => {
  const fx = freshStore();
  try {
    const s = fx.store;
    addStatement(s, { id: 'st-c', kind: 'constraint', text: 'Never write outside the project root', provenance: 'user', at: T0 });
    addEntity(s, { id: 'req-1', kind: 'requirement', name: 'Exports finish under a minute', at: T0 });
    addEntity(s, { id: 'old', kind: 'artifact', name: 'Design v1', at: T0 });
    addEntity(s, { id: 'new', kind: 'artifact', name: 'Design v2', at: T0 });
    addRelation(s, { id: 'r-sup', kind: 'supersedes', fromId: 'new', toId: 'old', basis: 'declared', confidence: 1, confirmed: true, at: T0 });
    addSource(s, { id: 'docs', kind: 'docs', purpose: 'design', authorityLevel: 'authoritative', sensitivity: 'internal', canRead: true, canWrite: false, authoritativeFor: ['requirement'], at: T0 });
    addEntity(s, { id: 'svc', kind: 'system', name: 'exporter', at: T0 });
    addClaim(s, { id: 'c-old', subjectId: 'svc', claimType: 'requirement', statement: 'exports run nightly', sourceId: 'docs', provenance: 'source', authority: 'authoritative', sensitivity: 'internal', confidence: 1, observedAt: T0, at: T0 });
    recordSnapshot(s, { id: 'snap-1', sourceId: 'docs', digest: 'v2', at: T1 });
    const found = detectDrift(s, { at: T1 });
    const kinds = found.map((f) => f.kind).sort();
    assert.deepEqual(kinds, ['duplicate_active_document', 'stale_dependent_claims', 'unlinked_requirement', 'unverified_obligation']);
    const stale = found.find((f) => f.kind === 'stale_dependent_claims')!;
    assert.match(stale.summary, /docs changed on 2026-09-02/);
    assert.deepEqual(stale.affected, ['claim:c-old']);
    const dup = found.find((f) => f.kind === 'duplicate_active_document')!;
    assert.match(dup.summary, /"Design v1" is superseded by "Design v2" but is still active/);
    setEntityStatus(s, 'old', 'superseded', T1);
    assert.ok(!detectDrift(s, { at: T1 }).some((f) => f.kind === 'duplicate_active_document'));
    const req = found.find((f) => f.kind === 'unlinked_requirement')!;
    assert.match(req.summary, /no implementation and no verification/);
  } finally {
    fx.cleanup();
  }
});

test('initiatives, work, capacity, and authority: the strategy fixture', () => {
  const fx = freshStore();
  try {
    const s = fx.store;
    addSource(s, { id: 'hris', kind: 'hris', purpose: 'people', authorityLevel: 'authoritative', sensitivity: 'confidential', canRead: true, canWrite: false, authoritativeFor: ['reporting_line'], notAuthoritativeFor: ['capacity', 'allocation'], at: T0 });
    addSource(s, { id: 'jira', kind: 'jira', purpose: 'work', authorityLevel: 'authoritative', sensitivity: 'internal', canRead: true, canWrite: true, authoritativeFor: ['work_item'], notAuthoritativeFor: ['capacity'], at: T0 });
    addSource(s, { id: 'plan', kind: 'docs', purpose: 'planning', authorityLevel: 'authoritative', sensitivity: 'internal', canRead: true, canWrite: false, authoritativeFor: ['allocation'], at: T0 });
    addEntity(s, { id: 'team', kind: 'team', name: 'Platform', at: T0 });
    addEntity(s, { id: 'i1', kind: 'initiative', name: 'Billing rewrite', at: T0 });
    addEntity(s, { id: 'i2', kind: 'initiative', name: 'SSO', at: T0 });
    addEntity(s, { id: 'i3', kind: 'initiative', name: 'Nothing attached', at: T0 });
    addEntity(s, { id: 'w1', kind: 'work_item', name: 'PROJ-1', externalRef: 'PROJ-1', at: T0 });
    addEntity(s, { id: 'w2', kind: 'work_item', name: 'PROJ-2 orphan', externalRef: 'PROJ-2', at: T0 });
    addEntity(s, { id: 'm1', kind: 'metric', name: 'invoice latency', at: T0 });
    for (const [id, init] of [['o1', 'i1'], ['o2', 'i2']] as const) {
      addRelation(s, { id, kind: 'owned_by', fromId: init, toId: 'team', basis: 'declared', confidence: 1, at: T0 });
      setRelationStatus(s, id, 'confirmed');
    }
    addRelation(s, { id: 'c1', kind: 'contributes_to', fromId: 'w1', toId: 'i1', basis: 'declared', confidence: 1, confirmed: true, at: T0 });
    addRelation(s, { id: 'v1', kind: 'verifies', fromId: 'm1', toId: 'i1', basis: 'declared', confidence: 1, confirmed: true, at: T0 });
    addClaim(s, { id: 'a1', subjectId: 'i1', claimType: 'allocation', statement: 'Platform 70% on billing', value: 0.7, sourceId: 'plan', provenance: 'source', authority: 'authoritative', sensitivity: 'internal', confidence: 1, observedAt: T0, at: T0 });
    addClaim(s, { id: 'a2', subjectId: 'i2', claimType: 'allocation', statement: 'Platform 60% on SSO', value: 0.6, sourceId: 'plan', provenance: 'source', authority: 'authoritative', sensitivity: 'internal', confidence: 1, observedAt: T0, at: T0 });
    // A confirmed capacity claim resting on Jira, which is declared not authoritative for capacity.
    addClaim(s, { id: 'cap', subjectId: 'team', claimType: 'capacity', statement: 'velocity 40 points', value: 40, sourceId: 'jira', provenance: 'source', authority: 'informative', sensitivity: 'internal', confidence: 0.9, observedAt: T0, at: T0 });
    s.db.prepare(`UPDATE claims SET status = 'confirmed' WHERE id = 'cap'`).run();

    const found = detectDrift(s, { at: T1 });
    const kinds = found.map((f) => f.kind);
    assert.ok(kinds.includes('capacity_conflict'));
    const cap = found.find((f) => f.kind === 'capacity_conflict')!;
    assert.match(cap.summary, /Platform is allocated 130% across "Billing rewrite", "SSO"/);
    assert.deepEqual(cap.evidence.map((e) => e.ref), ['claim:a1', 'claim:a2']);
    const incomplete = found.filter((f) => f.kind === 'initiative_incomplete');
    assert.equal(incomplete.length, 2, 'SSO lacks work and a measure; the third lacks everything');
    assert.match(incomplete.find((f) => f.affected[0] === 'entity:i3')!.summary, /lacks a confirmed owner, linked work, a measure, a capacity allocation/);
    const orphan = found.find((f) => f.kind === 'work_without_goal')!;
    assert.match(orphan.summary, /PROJ-2 orphan/);
    const authority = found.find((f) => f.kind === 'insufficient_authority')!;
    assert.match(authority.summary, /velocity 40 points.*jira.*not declared authoritative for capacity/);
    assert.match(authority.repairPath, /re-source the claim/);
  } finally {
    fx.cleanup();
  }
});

test('a change without a decision is a finding only when the project requires one', () => {
  const fx = freshStore();
  try {
    const s = fx.store;
    addEntity(s, { id: 'dec', kind: 'decision', name: 'Cache reads', at: T0 });
    addEntity(s, { id: 'code', kind: 'code_component', name: 'cache.ts', at: T0 });
    addRelation(s, { id: 'g', kind: 'governs', fromId: 'dec', toId: 'code', basis: 'declared', confidence: 1, confirmed: true, at: T0 });
    addClaim(s, { id: 'ch', subjectId: 'code', claimType: 'changed', statement: 'cache.ts changed', provenance: 'source', authority: 'informative', sensitivity: 'internal', confidence: 1, observedAt: T1, at: T1 });
    assert.deepEqual(detectDrift(s, { at: T1 }), []);
    const strict = detectDrift(s, { at: T1, requireDecisionForChanges: true });
    assert.equal(strict.length, 1);
    assert.equal(strict[0]!.kind, 'change_without_decision');
    assert.equal(strict[0]!.confidence, 0.6);
  } finally {
    fx.cleanup();
  }
});
