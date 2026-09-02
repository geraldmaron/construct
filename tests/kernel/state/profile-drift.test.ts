/**
 * tests/kernel/state/profile-drift.test.ts — the profile names what is missing,
 * statements confirm only from a person, findings carry evidence, lessons are
 * never admitted by a run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  upsertProfile, getProfile, missingProfileFields, addStatement, listStatements, setStatementStatus,
} from '../../../src/kernel/state/profile.ts';
import {
  recordObservation, listObservations, addDriftFinding, setDriftStatus, listDriftFindings,
  proposeLesson, advanceLesson, listLessons, LESSON_TRANSITIONS,
} from '../../../src/kernel/state/drift.ts';
import { createStaffMember, setAssignments, setStaffStatus, listStaffMembers } from '../../../src/kernel/state/staff.ts';
import { recordResolvedSkill, listResolvedSkills, recordResolvedWorkflow, listResolvedWorkflows, forgetResolvedSkill } from '../../../src/kernel/state/resolved.ts';
import { createRun } from '../../../src/kernel/state/runs.ts';
import { IllegalTransitionError } from '../../../src/kernel/state/rows.ts';
import { freshStore, clock } from './support.ts';

test('the profile starts incomplete and names what is missing', () => {
  const fx = freshStore();
  try {
    const at = clock();
    assert.deepEqual(missingProfileFields(getProfile(fx.store)), ['name', 'purpose', 'scale', 'primaryOutcome']);
    upsertProfile(fx.store, { name: 'construct', purpose: 'operating layer for agent hosts' }, at());
    assert.deepEqual(missingProfileFields(getProfile(fx.store)), ['scale', 'primaryOutcome']);
    const p = upsertProfile(fx.store, { scale: 'solo', primaryOutcome: 'ship the cutover', onboardingState: 'drafted' }, at());
    assert.equal(p.name, 'construct');
    assert.equal(p.onboardingState, 'drafted');
    assert.deepEqual(missingProfileFields(p), []);
    assert.throws(() => upsertProfile(fx.store, { scale: 'galactic' as never }, at()), /scale must be one of/);
  } finally {
    fx.cleanup();
  }
});

test('a remembered decision is one confirmed statement; discovery only proposes', () => {
  const fx = freshStore();
  try {
    const at = clock();
    const remembered = addStatement(fx.store, { id: 'st-1', kind: 'decision', text: 'We will not add schema migration until stable.', provenance: 'user', at: at() });
    assert.equal(remembered.status, 'confirmed');
    const guessed = addStatement(fx.store, { id: 'st-2', kind: 'principle', text: 'Kernel stays host-agnostic', provenance: 'discovery', at: at() });
    assert.equal(guessed.status, 'proposed');
    assert.equal(listStatements(fx.store, { status: 'confirmed' }).length, 1);
    setStatementStatus(fx.store, { id: 'st-2', status: 'confirmed', at: at() });
    assert.equal(listStatements(fx.store, { kind: 'principle', status: 'confirmed' }).length, 1);

    addStatement(fx.store, { id: 'g-1', kind: 'glossary_entry', term: 'run', text: 'one execution of a workflow', provenance: 'user', at: at() });
    assert.throws(() => addStatement(fx.store, { id: 'g-2', kind: 'glossary_entry', term: 'run', text: 'dup', provenance: 'user', at: at() }), /UNIQUE/);
    assert.throws(() => addStatement(fx.store, { id: 'g-3', kind: 'glossary_entry', text: 'no term', provenance: 'user', at: at() }), /needs a term/);

    addStatement(fx.store, { id: 'st-3', kind: 'decision', text: 'Migration allowed after 3.1', provenance: 'user', at: at() });
    const old = setStatementStatus(fx.store, { id: 'st-1', status: 'superseded', supersededBy: 'st-3', at: at() });
    assert.equal(old.supersededBy, 'st-3');
    assert.throws(() => setStatementStatus(fx.store, { id: 'st-1', status: 'confirmed', at: at() }), IllegalTransitionError);
    assert.throws(() => setStatementStatus(fx.store, { id: 'st-3', status: 'superseded', at: at() }), /names its successor/);
  } finally {
    fx.cleanup();
  }
});

test('drift findings need evidence and an affected obligation; status moves forward', () => {
  const fx = freshStore();
  try {
    const at = clock();
    createRun(fx.store, { id: 'run-1', workflowId: 'source-drift', workflowVersion: '1.0.0', interactionClass: 'maintain', triggerKind: 'schedule', idempotencyKey: 'k', executorKind: 'headless', executorId: 'cron', input: {}, at: at() });
    recordObservation(fx.store, { id: 'ob-1', runId: 'run-1', kind: 'source.changed', summary: 'design.md digest changed', evidence: { digest: 'def' }, at: at() });
    assert.equal(listObservations(fx.store, { runId: 'run-1' }).length, 1);
    assert.throws(() => addDriftFinding(fx.store, { id: 'f', runId: 'run-1', kind: 'stale_dependent_claims', summary: 'x', evidence: [], affected: ['st-1'], confidence: 0.9, repairPath: 'refresh', at: at() }), /at least one piece of evidence/);
    assert.throws(() => addDriftFinding(fx.store, { id: 'f', runId: 'run-1', kind: 'stale_dependent_claims', summary: 'x', evidence: [{ ref: 'design.md' }], affected: [], confidence: 0.9, repairPath: 'refresh', at: at() }), /affected obligation/);
    const f = addDriftFinding(fx.store, { id: 'f-1', runId: 'run-1', kind: 'stale_dependent_claims', summary: 'design.md changed; 2 claims depend on it', evidence: [{ ref: 'design.md', digest: 'def' }], affected: ['claim:c1', 'claim:c2'], confidence: 0.9, repairPath: 'refresh the two claims from the new snapshot', at: at() });
    assert.equal(f.status, 'open');
    setDriftStatus(fx.store, { id: 'f-1', status: 'acknowledged', by: 'gerald', at: at() });
    assert.throws(() => setDriftStatus(fx.store, { id: 'f-1', status: 'open', by: 'gerald', at: at() }), IllegalTransitionError);
    const repaired = setDriftStatus(fx.store, { id: 'f-1', status: 'repaired', by: 'gerald', at: at() });
    assert.ok(repaired.resolvedAt);
    assert.equal(listDriftFindings(fx.store, { status: 'open' }).length, 0);
  } finally {
    fx.cleanup();
  }
});

test('a lesson walks the ladder and a run cannot skip approval', () => {
  const fx = freshStore();
  try {
    const at = clock();
    assert.throws(() => proposeLesson(fx.store, { id: 'l', statement: 'x', evidence: [], scope: ['skill:intake'], at: at() }), /with evidence/);
    const l = proposeLesson(fx.store, { id: 'l-1', statement: 'Reviews that skip the source read miss stale principles', evidence: [{ run: 'run-9' }], scope: ['workflow:design-conformance'], at: at() });
    assert.equal(l.status, 'proposed');
    assert.throws(() => advanceLesson(fx.store, { id: 'l-1', to: 'admitted', by: 'run-9', at: at() }), IllegalTransitionError);
    advanceLesson(fx.store, { id: 'l-1', to: 'checked', by: 'validator', at: at() });
    advanceLesson(fx.store, { id: 'l-1', to: 'approved', by: 'gerald', at: at() });
    const admitted = advanceLesson(fx.store, { id: 'l-1', to: 'admitted', by: 'gerald', at: at() });
    assert.equal(admitted.status, 'admitted');
    proposeLesson(fx.store, { id: 'l-2', statement: 'v2 of the lesson', evidence: [{ run: 'run-10' }], scope: ['workflow:design-conformance'], version: 2, at: at() });
    const superseded = advanceLesson(fx.store, { id: 'l-1', to: 'superseded', by: 'gerald', supersededBy: 'l-2', at: at() });
    assert.equal(superseded.supersededBy, 'l-2');
    assert.deepEqual(LESSON_TRANSITIONS.superseded, []);
    assert.equal(listLessons(fx.store, { status: 'proposed' }).length, 1);
  } finally {
    fx.cleanup();
  }
});

test('staff assignments and resolved bundles round-trip', () => {
  const fx = freshStore();
  try {
    const at = clock();
    const m = createStaffMember(fx.store, { id: 'sm-1', name: 'Reviewer', title: 'Design reviewer', mission: 'keep principles honest', capabilities: ['review', 'review'], skillIds: ['adversarial-review'], at: at() });
    assert.deepEqual(m.capabilities, ['review']);
    setAssignments(fx.store, 'sm-1', ['review', 'drift'], [], at());
    assert.deepEqual(listStaffMembers(fx.store)[0]?.capabilities, ['drift', 'review']);
    assert.equal(setStaffStatus(fx.store, 'sm-1', 'paused', at()).status, 'paused');
    assert.equal(listStaffMembers(fx.store, { status: 'active' }).length, 0);

    recordResolvedSkill(fx.store, { id: 'intake', version: '1.0.0', digest: 'aaa', origin: 'builtin', resolvedAt: at() });
    recordResolvedSkill(fx.store, { id: 'intake', version: '1.1.0', digest: 'bbb', origin: 'builtin', resolvedAt: at() });
    recordResolvedWorkflow(fx.store, { id: 'remember', version: '1.0.0', digest: 'ccc', origin: 'builtin', resolvedAt: at() });
    assert.deepEqual(listResolvedSkills(fx.store).map((s) => s.version), ['1.1.0']);
    assert.equal(listResolvedWorkflows(fx.store).length, 1);
    forgetResolvedSkill(fx.store, 'intake');
    assert.equal(listResolvedSkills(fx.store).length, 0);
  } finally {
    fx.cleanup();
  }
});
