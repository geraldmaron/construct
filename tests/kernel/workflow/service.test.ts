/**
 * tests/kernel/workflow/service.test.ts — one idempotent run, steps leased
 * and gated, outputs validated, a pause for approval, resume after a lost
 * lease, retry, cancel, and a deliverable that only the kernel promotes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listStatements } from '../../../src/kernel/state/profile.ts';
import { listActivity } from '../../../src/kernel/state/activity.ts';
import { listGrants } from '../../../src/kernel/state/grants.ts';
import { listAttempts } from '../../../src/kernel/state/steps.ts';
import { fixture } from './support.ts';

test('answer creates nothing; remember creates one confirmed statement, no run, no tasks', () => {
  const fx = fixture();
  try {
    assert.equal(fx.service.classify('What does this function do?').class, 'answer');
    assert.equal(listActivity(fx.store).length, 0);
    const s = fx.service.remember({ kind: 'decision', text: 'We will not add schema migration until stable.', by: 'gerald' });
    assert.equal(s.status, 'confirmed');
    assert.equal(s.provenance, 'user');
    assert.equal(listStatements(fx.store).length, 1);
    assert.equal(fx.service.status('run-001'), null);
    assert.deepEqual(listActivity(fx.store).map((e) => e.kind), ['remember']);
    assert.throws(() => fx.service.start({ workflowId: 'nope', input: {}, trigger: 'manual' }), /no workflow "nope"/);
  } finally {
    fx.cleanup();
  }
});

test('a managed run: idempotent start, ordered leases, validated outputs, a drafted then validated deliverable, kernel-owned promotion', () => {
  const fx = fixture();
  try {
    const first = fx.service.start({ workflowId: 'review', input: { target: 'feature-x' }, trigger: 'manual' });
    assert.equal(first.created, true);
    assert.equal(first.run.state, 'ready');
    assert.equal(first.preflight.status, 'runnable');
    const again = fx.service.start({ workflowId: 'review', input: { target: 'feature-x' }, trigger: 'manual' });
    assert.equal(again.created, false);
    assert.equal(again.run.id, first.run.id);
    const other = fx.service.start({ workflowId: 'review', input: { target: 'feature-y' }, trigger: 'manual' });
    assert.equal(other.created, false, 'concurrency single: the active run is returned');
    assert.match(other.preflight.flags.join(' '), /already exists/);

    const c1 = fx.service.claimNext({ runId: first.run.id });
    assert.ok(c1.packet);
    assert.equal(c1.packet!.step.id, 'gather');
    assert.equal(c1.packet!.skill?.id, 'reader');
    assert.match(c1.packet!.skill!.body()!, /^---\nname: reader/);
    assert.equal(fx.service.status(first.run.id)!.run.state, 'running');
    assert.deepEqual(fx.service.claimNext({ runId: first.run.id }).waitingOn, { kind: 'nothing_ready' }, 'write waits for gather');

    // A submission with no evidence fails citations_present and is retried once.
    const bad = fx.service.submit({ leased: c1.packet!.leased, output: { notes: 'n' }, evidence: [] });
    assert.equal(bad.step.state, 'ready');
    assert.equal(bad.validation[0]!.ok, false);
    const c1b = fx.service.claimNext({ runId: first.run.id });
    assert.equal(c1b.packet!.step.id, 'gather');
    assert.equal(c1b.packet!.leased.token, 2);
    const ok = fx.service.submit({ leased: c1b.packet!.leased, output: { notes: 'read the design doc' }, evidence: [{ ref: 'docs/design.md' }] });
    assert.equal(ok.step.state, 'succeeded');
    assert.deepEqual(listAttempts(fx.store, c1.packet!.leased.id).map((a) => a.outcome), ['failed', 'succeeded']);

    const c2 = fx.service.claimNext({ runId: first.run.id });
    assert.equal(c2.packet!.step.id, 'write');
    assert.deepEqual(c2.packet!.inputs, { notes: 'read the design doc' });
    const written = fx.service.submit({ leased: c2.packet!.leased, output: { summary: 'two findings', findings: [{ text: 'a', citations: ['docs/design.md'] }] }, evidence: [{ ref: 'docs/design.md' }] });
    assert.equal(written.step.state, 'succeeded');
    assert.equal(written.deliverable?.trustState, 'draft', 'a challenge step drafts; it does not validate the final deliverable');

    const c3 = fx.service.claimNext({ runId: first.run.id });
    assert.equal(c3.packet!.step.id, 'record');
    assert.equal(c3.packet!.step.tier, 'project_write');
    const recorded = fx.service.submit({ leased: c3.packet!.leased, output: { recorded: true, summary: 'two findings', findings: [] }, evidence: [] });
    assert.equal(recorded.run.state, 'succeeded');
    assert.equal(recorded.deliverable?.trustState, 'validated');

    const view = fx.service.status(first.run.id)!;
    assert.deepEqual(view.steps.map((s) => s.state), ['succeeded', 'succeeded', 'succeeded']);
    assert.equal(view.deliverables.length, 2);
    const final = view.deliverables.find((d) => d.trustState === 'validated')!;
    assert.throws(() => fx.service.promote({ deliverableId: final.id, to: 'final', by: 'gerald' }), /only after it was accepted/);
    fx.service.promote({ deliverableId: final.id, to: 'challenged', by: 'adversarial-review', verification: { verdict: 'accepted with controls' } });
    fx.service.promote({ deliverableId: final.id, to: 'accepted', by: 'gerald' });
    const done = fx.service.promote({ deliverableId: final.id, to: 'final', by: 'gerald' });
    assert.equal(done.trustState, 'final');
    assert.deepEqual(fx.service.claimNext({ runId: first.run.id }).waitingOn, { kind: 'finished', state: 'succeeded' });
  } finally {
    fx.cleanup();
  }
});

test('an external write pauses for the smallest approval; approval resumes exactly that step; a declined step cancels it', () => {
  const fx = fixture();
  try {
    const started = fx.service.start({ workflowId: 'apply', input: { target: 'PROJ-14' }, trigger: 'manual' });
    assert.equal(started.run.state, 'ready');
    assert.deepEqual(started.preflight.approvalsAhead, ['push']);
    const d = fx.service.claimNext({ runId: started.run.id });
    fx.service.submit({ leased: d.packet!.leased, output: { change: 'set status Done' } });
    const paused = fx.service.claimNext({ runId: started.run.id });
    assert.equal(paused.packet, null);
    assert.equal(paused.waitingOn?.kind, 'decision');
    const decision = paused.waitingOn!.kind === 'decision' ? paused.waitingOn.decision : null;
    assert.equal(decision!.kind, 'approval');
    assert.deepEqual(decision!.options, ['approve', 'decline']);
    assert.match(decision!.question, /Approve exactly this/);
    assert.equal(fx.service.status(started.run.id)!.run.state, 'waiting_for_decision');
    const same = fx.service.claimNext({ runId: started.run.id });
    assert.equal(same.waitingOn?.kind === 'decision' ? same.waitingOn.decision.id : null, decision!.id, 'one question, not one per poll');

    const resolved = fx.service.decide({ decisionId: decision!.id, resolution: 'approve', by: 'gerald' });
    assert.equal(resolved.run?.state, 'running');
    const grants = listGrants(fx.store);
    assert.equal(grants.length, 1);
    assert.equal(grants[0]!.targetResource, 'PROJ-14');
    assert.equal(grants[0]!.executorId, 'session:claude');
    assert.ok(grants[0]!.endsAt);
    const push = fx.service.claimNext({ runId: started.run.id });
    assert.equal(push.packet!.step.id, 'push');
    const done = fx.service.submit({ leased: push.packet!.leased, output: { applied: true } });
    assert.equal(done.run.state, 'succeeded');

    // A second run for another ticket: the approval did not widen.
    const second = fx.service.start({ workflowId: 'apply', input: { target: 'PROJ-15' }, trigger: 'manual' });
    assert.equal(second.created, true);
    const d2 = fx.service.claimNext({ runId: second.run.id });
    fx.service.submit({ leased: d2.packet!.leased, output: { change: 'x' } });
    const paused2 = fx.service.claimNext({ runId: second.run.id });
    assert.equal(paused2.waitingOn?.kind, 'decision');
    const declined = fx.service.decide({ decisionId: (paused2.waitingOn as { decision: { id: string } }).decision.id, resolution: 'decline', by: 'gerald' });
    assert.equal(declined.run?.state, 'running');
    const after = fx.service.status(second.run.id)!;
    assert.equal(after.steps.find((s) => s.stepId === 'push')!.state, 'cancelled');
  } finally {
    fx.cleanup();
  }
});

test('a lost lease is reclaimed without repeating finished work; cancel and no-data follow policy', () => {
  const fx = fixture();
  try {
    const started = fx.service.start({ workflowId: 'review', input: { target: 't' }, trigger: 'manual' });
    const c1 = fx.service.claimNext({ runId: started.run.id, leaseMs: 60_000 });
    fx.service.submit({ leased: c1.packet!.leased, output: { notes: 'n' }, evidence: [{ ref: 'x' }] });
    const c2 = fx.service.claimNext({ runId: started.run.id, leaseMs: 60_000 });
    assert.equal(c2.packet!.step.id, 'write');
    // The session dies. Time passes. A resume finds the lease expired and hands the same step out once more.
    fx.tick(61_000);
    fx.service.resume(started.run.id);
    const c2b = fx.service.claimNext({ runId: started.run.id });
    assert.equal(c2b.packet!.step.id, 'write');
    assert.equal(c2b.packet!.leased.token, 2);
    assert.equal(fx.service.status(started.run.id)!.steps.find((s) => s.stepId === 'gather')!.state, 'succeeded', 'finished work is not repeated');
    // The dead holder cannot settle the step any more.
    assert.throws(() => fx.service.submit({ leased: c2.packet!.leased, output: { summary: 's', findings: [] } }), /no longer held/);

    const cancelled = fx.service.cancel({ runId: started.run.id, by: 'gerald', reason: 'changed my mind' });
    assert.equal(cancelled.state, 'running', 'cancellation after_step waits for the leased step');
    fx.service.fail({ leased: c2b.packet!.leased, error: {}, reason: 'stopped' });
    const view = fx.service.status(started.run.id)!;
    assert.equal(view.run.state, 'failed');
    assert.equal(view.steps.find((s) => s.stepId === 'record')!.state, 'cancelled');

    // No data on a workflow whose policy is block: a decision is raised; continue skips the step.
    const apply = fx.service.start({ workflowId: 'apply', input: { target: 'PROJ-1' }, trigger: 'manual' });
    const d = fx.service.claimNext({ runId: apply.run.id });
    const noData = fx.service.submit({ leased: d.packet!.leased, output: {}, noData: true });
    assert.equal(noData.run.state, 'waiting_for_decision');
    const q = fx.service.status(apply.run.id)!.openDecisions[0]!;
    assert.deepEqual(q.options, ['continue', 'stop']);
    fx.service.decide({ decisionId: q.id, resolution: 'stop', by: 'gerald' });
    assert.equal(fx.service.status(apply.run.id)!.steps.find((s) => s.stepId === 'draft')!.state, 'cancelled');
    const immediate = fx.service.cancel({ runId: apply.run.id, by: 'gerald', reason: 'done' });
    assert.equal(immediate.state, 'cancelled');
  } finally {
    fx.cleanup();
  }
});

test('a blocked start records why, resumes once the world changes, and arbitrary steps cannot be enqueued', () => {
  const fx = fixture();
  try {
    fx.sources = [];
    const blocked = fx.service.start({ workflowId: 'apply', input: { target: 'PROJ-1' }, trigger: 'manual' });
    assert.equal(blocked.run.state, 'blocked');
    assert.ok(blocked.preflight.reasons.some((r) => r.code === 'unavailable_source'));
    assert.equal(fx.service.status(blocked.run.id)!.steps.length, 0, 'no steps exist for a blocked run');
    assert.deepEqual(fx.service.claimNext({ runId: blocked.run.id }).waitingOn, { kind: 'nothing_ready' });
    fx.sources = [{ kind: 'jira', id: 'jira', reachability: 'reachable', freshness: 'no_expectation' }];
    const resumed = fx.service.resume(blocked.run.id);
    assert.equal(resumed.state, 'ready');
    assert.deepEqual(fx.service.status(blocked.run.id)!.steps.map((s) => s.stepId), ['draft', 'push']);
    assert.throws(() => fx.service.start({ workflowId: 'apply', input: { target: 'x' }, trigger: 'schedule' }), /does not accept schedule/);
    assert.throws(() => fx.service.start({ workflowId: 'review', input: { target: 't' }, trigger: 'event' }), /does not accept event/);
    // The only way work enters a run is the resolver's plan: there is no API to add a step or a role.
    assert.equal('enqueue' in fx.service, false);
    assert.equal('addTask' in fx.service, false);
  } finally {
    fx.cleanup();
  }
});

test('project policy never: the project_write step asks instead of writing', () => {
  const fx = fixture({ projectWritePolicy: 'never' });
  try {
    assert.equal(fx.service.remember({ kind: 'note', text: 'x', by: 'g' }).status, 'confirmed', 'remembering writes Construct state, which project policy does not govern');
    const started = fx.service.start({ workflowId: 'review', input: { target: 't' }, trigger: 'manual' });
    const c1 = fx.service.claimNext({ runId: started.run.id });
    fx.service.submit({ leased: c1.packet!.leased, output: { notes: 'n' }, evidence: [{ ref: 'x' }] });
    const c2 = fx.service.claimNext({ runId: started.run.id });
    fx.service.submit({ leased: c2.packet!.leased, output: { summary: 's', findings: [] }, evidence: [{ ref: 'x' }] });
    const paused = fx.service.claimNext({ runId: started.run.id });
    assert.equal(paused.waitingOn?.kind, 'decision');
    assert.equal((paused.waitingOn as { decision: { kind: string } }).decision.kind, 'blocked');
  } finally {
    fx.cleanup();
  }
});
