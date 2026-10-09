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
import { getStep, listAttempts } from '../../../src/kernel/state/steps.ts';
import { getDecision } from '../../../src/kernel/state/decisions.ts';
import { getDeliverable } from '../../../src/kernel/state/deliverables.ts';
import { addSource } from '../../../src/kernel/state/sources.ts';
import type { RefResolver } from '../../../src/kernel/project/evidence.ts';
import { addEntity, addRelation } from '../../../src/kernel/state/graph.ts';
import { fixture, T0 } from './support.ts';

test('answer creates nothing; remember creates one confirmed statement, no run, no tasks', () => {
  const fx = fixture();
  try {
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
    assert.deepEqual(again.differs, []);
    const other = fx.service.start({ workflowId: 'review', input: { target: 'feature-y' }, trigger: 'manual' });
    assert.equal(other.created, false, 'concurrency single: the active run is returned');
    assert.match(other.preflight.flags.join(' '), /already exists/);
    assert.deepEqual(other.differs, ['target'], 'the run handed back says which input it was started with differently');

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
    assert.throws(() => fx.service.promote({ deliverableId: final.id, to: 'final', by: 'gerald', channel: 'tty_cli' }), /only after it was accepted/);
    fx.service.promote({ deliverableId: final.id, to: 'challenged', by: 'adversarial-review', verification: { challenge: { objections: [] } } });
    fx.service.promote({ deliverableId: final.id, to: 'accepted', by: 'gerald', channel: 'tty_cli' });
    const done = fx.service.promote({ deliverableId: final.id, to: 'final', by: 'gerald', channel: 'tty_cli' });
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

    const resolved = fx.service.decide({ decisionId: decision!.id, resolution: 'approve', by: 'gerald', channel: 'tty_cli' });
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
    assert.equal(declined.run?.state, 'cancelled');
    const after = fx.service.status(second.run.id)!;
    assert.equal(after.steps.find((s) => s.stepId === 'push')!.state, 'cancelled');
    assert.equal(after.steps.find((s) => s.stepId === 'draft')!.state, 'succeeded');
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
    assert.equal(view.run.state, 'cancelled', 'after-step cancel settles as cancelled once the leased step ends');
    assert.equal(view.steps.find((s) => s.stepId === 'record')!.state, 'cancelled');
    // The expired attempt did not spend write's budget, so its one failure left
    // a retry, and the cancellation withdrew that retry.
    assert.equal(view.steps.find((s) => s.stepId === 'write')!.state, 'cancelled');

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
    const stuck = fx.service.claimNext({ runId: blocked.run.id });
    assert.equal(stuck.packet, null);
    assert.deepEqual(stuck.waitingOn, { kind: 'blocked', runId: blocked.run.id, summary: blocked.run.stateReason, reasons: blocked.preflight.reasons }, 'a claim on a blocked run says why, with what would clear it');
    assert.ok(blocked.preflight.reasons.every((r) => r.remedy.length > 0));
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

test('architectural work is challenged without magic words; a helper rename is not', () => {
  const fx = fixture();
  try {
    const arch = fx.service.start({ workflowId: 'ship', input: { request: 'Introduce a shared database for billing and identity' }, trigger: 'manual' });
    assert.equal(arch.preflight.judgment.challenge, true);
    const claimed = fx.service.claimNext({ runId: arch.run.id });
    assert.match(claimed.packet!.instructions.join(' '), /adversarial review/);
    const submitted = fx.service.submit({ leased: claimed.packet!.leased, output: { summary: 'add postgres', findings: [] } });
    assert.equal(submitted.deliverable?.trustState, 'validated');
    assert.throws(
      () => fx.service.promote({ deliverableId: submitted.deliverable!.id, to: 'accepted', by: 'gerald', channel: 'tty_cli' }),
      /recorded challenge/,
    );
    fx.service.promote({ deliverableId: submitted.deliverable!.id, to: 'challenged', by: 'adversarial-review', verification: { challenge: { objections: [] } } });
    const accepted = fx.service.promote({ deliverableId: submitted.deliverable!.id, to: 'accepted', by: 'gerald', channel: 'tty_cli' });
    assert.equal(accepted.trustState, 'accepted');

    const unusual = fx.service.start({ workflowId: 'ship', input: { request: 'Put identity and billing on the same postgres' }, trigger: 'manual' });
    assert.equal(unusual.preflight.judgment.challenge, true, 'unusual shared-store phrasing still requires challenge');
    const u1 = fx.service.claimNext({ runId: unusual.run.id });
    const uDone = fx.service.submit({ leased: u1.packet!.leased, output: { summary: 'split stores', findings: [] } });
    assert.throws(
      () => fx.service.promote({ deliverableId: uDone.deliverable!.id, to: 'accepted', by: 'gerald', channel: 'tty_cli' }),
      /recorded challenge/,
      'unusual phrasing cannot bypass promote to accepted',
    );

    const trivial = fx.service.start({ workflowId: 'ship', input: { request: 'Rename a private helper in the invoice formatter' }, trigger: 'manual' });
    assert.equal(trivial.preflight.judgment.challenge, false);
    assert.equal(trivial.preflight.judgment.depth, 'standard', 'an unanswered scale is treated as a team project, not a small one');
    const t1 = fx.service.claimNext({ runId: trivial.run.id });
    assert.equal(t1.packet!.judgment.depth, 'standard');
    assert.doesNotMatch(t1.packet!.instructions.join(' '), /side project|keep the process small|adversarial review/);
    const done = fx.service.submit({ leased: t1.packet!.leased, output: { summary: 'renamed', findings: [] } });
    const trusted = fx.service.promote({ deliverableId: done.deliverable!.id, to: 'accepted', by: 'gerald', channel: 'tty_cli' });
    assert.equal(trusted.trustState, 'accepted');
  } finally {
    fx.cleanup();
  }
});

test('stakes the host declared at start survive a block and a resume, and still demand a challenge before acceptance', () => {
  const fx = fixture();
  try {
    const declared = { stakes: { reversible: false, affects: [] }, chosenSkill: null, words: null };
    assert.equal(fx.service.judge({ workflowId: 'sweep', input: {} }).depth, 'standard', 'nothing in the structure raises it');
    assert.equal(fx.service.judge({ workflowId: 'sweep', input: {}, declared }).depth, 'challenged');

    fx.sources = [{ kind: 'directory', id: 'repo', reachability: 'reachable', freshness: 'stale' }];
    const started = fx.service.start({ workflowId: 'sweep', input: {}, trigger: 'manual', asked: { declared } });
    assert.equal(started.run.state, 'blocked');
    assert.equal(started.preflight.judgment.challenge, true);
    assert.deepEqual((started.run.bindings as { asked: unknown }).asked, { declared }, 'the reading is frozen on the run');

    fx.sources = [{ kind: 'directory', id: 'repo', reachability: 'reachable', freshness: 'fresh' }];
    const resumed = fx.service.resume(started.run.id);
    assert.equal(resumed.state, 'ready');
    const shown = resumed.preflight as { judgment: { challenge: boolean; signals: { kind: string }[] } };
    assert.equal(shown.judgment.challenge, true, 'resume reads the frozen stakes, not the input alone');
    assert.ok(shown.judgment.signals.some((sig) => sig.kind === 'host_stakes'));

    const claimed = fx.service.claimNext({ runId: started.run.id });
    assert.equal(claimed.packet!.judgment.challenge, true);
    assert.match(claimed.packet!.instructions.join(' '), /This run must be challenged before it is accepted: the host reported it is hard to undo\. Apply adversarial review/, 'the packet names what raised it, once');
    const done = fx.service.submit({ leased: claimed.packet!.leased, output: { seen: 'two files' } });
    assert.ok(done.deliverable);
    assert.throws(
      () => fx.service.promote({ deliverableId: done.deliverable!.id, to: 'accepted', by: 'gerald', channel: 'tty_cli' }),
      /recorded challenge/,
      'acceptance reads the same judgment',
    );
  } finally {
    fx.cleanup();
  }
});

test('unknowns stay unknown: a verified placeholder cannot be accepted', () => {
  const fx = fixture();
  try {
    const started = fx.service.start({ workflowId: 'ship', input: { request: 'Rename a private helper' }, trigger: 'manual' });
    const c = fx.service.claimNext({ runId: started.run.id });
    const invented = fx.service.submit({
      leased: c.packet!.leased,
      output: { summary: 'done', findings: ['lorem ipsum'], unknowns: ['the SLA'], verified: true, invented: true },
    });
    assert.equal(invented.deliverable?.trustState, 'validated');
    assert.throws(
      () => fx.service.promote({ deliverableId: invented.deliverable!.id, to: 'accepted', by: 'gerald', channel: 'tty_cli' }),
      /invented/,
    );
  } finally {
    fx.cleanup();
  }
});

test('an active contradiction blocks trusted finish', () => {
  const fx = fixture();
  try {
    const started = fx.service.start({ workflowId: 'ship', input: { request: 'Rename a private helper in the invoice formatter' }, trigger: 'manual' });
    const claimed = fx.service.claimNext({ runId: started.run.id });
    const submitted = fx.service.submit({
      leased: claimed.packet!.leased,
      output: { summary: 'renamed', findings: [] },
    });
    assert.equal(submitted.deliverable?.trustState, 'validated');

    addEntity(fx.store, { id: 'dec-gov', kind: 'decision', name: 'Keep one postgres', at: T0 });
    addEntity(fx.store, { id: 'code-db', kind: 'code_component', name: 'db.ts', at: T0 });
    addRelation(fx.store, {
      id: 'rel-contra',
      kind: 'contradicts',
      fromId: 'code-db',
      toId: 'dec-gov',
      basis: 'observed',
      confidence: 0.9,
      at: T0,
    });

    assert.throws(
      () => fx.service.promote({ deliverableId: submitted.deliverable!.id, to: 'accepted', by: 'gerald', channel: 'tty_cli' }),
      /active contradiction/,
    );
  } finally {
    fx.cleanup();
  }
});

test('nothing but passing checks makes a deliverable validated: promotion to it is refused from draft and from challenged, on every channel', () => {
  const fx = fixture();
  try {
    const started = fx.service.start({ workflowId: 'review', input: { target: 'trust' }, trigger: 'manual' });
    const gather = fx.service.claimNext({ runId: started.run.id });
    fx.service.submit({ leased: gather.packet!.leased, output: { notes: 'n' }, evidence: [{ ref: 'docs/design.md' }] });
    const write = fx.service.claimNext({ runId: started.run.id });
    const drafted = fx.service.submit({ leased: write.packet!.leased, output: { summary: 's', findings: [] }, evidence: [{ ref: 'docs/design.md' }] });
    const draftId = drafted.deliverable!.id;
    assert.equal(drafted.deliverable!.trustState, 'draft');
    for (const channel of ['relay', 'tty_cli', 'elicitation'] as const) {
      assert.throws(() => fx.service.promote({ deliverableId: draftId, to: 'validated', by: 'gerald', channel }), /validated is set when the step's checks pass, not by promotion/, `from draft on ${channel}`);
    }
    assert.throws(() => fx.service.requestPromotion({ deliverableId: draftId, to: 'validated', by: 'relayed via claude-code' }), /validated is set when the step's checks pass/);
    assert.equal(getDeliverable(fx.store, draftId)!.trustState, 'draft');

    fx.service.promote({ deliverableId: draftId, to: 'challenged', by: 'adversarial-review', verification: { challenge: { objections: [{ objection: 'no figure is sourced', disposition: 'open' }] } } });
    assert.throws(() => fx.service.promote({ deliverableId: draftId, to: 'validated', by: 'gerald', channel: 'tty_cli' }), /not by promotion/, 'from challenged on tty_cli');
    assert.equal(getDeliverable(fx.store, draftId)!.trustState, 'challenged');
  } finally {
    fx.cleanup();
  }
});

test('a challenge carries the objections it raised, merged over what the deliverable already held, and says whether the session that ran the work raised it', () => {
  const fx = fixture();
  try {
    const run = fx.service.start({ workflowId: 'ship', input: { request: 'Rename a private helper in the invoice formatter' }, trigger: 'manual' });
    const c = fx.service.claimNext({ runId: run.run.id });
    const id = fx.service.submit({ leased: c.packet!.leased, output: { summary: 'renamed', findings: [] } }).deliverable!.id;
    assert.equal(getDeliverable(fx.store, id)!.trustState, 'validated');

    assert.throws(() => fx.service.promote({ deliverableId: id, to: 'challenged', by: 'adversarial-review' }), /a challenge is recorded with the objections it raised/);
    assert.throws(() => fx.service.promote({ deliverableId: id, to: 'challenged', by: 'adversarial-review', verification: { verdict: 'holds' } }), /objections/);
    assert.throws(() => fx.service.promote({ deliverableId: id, to: 'challenged', by: 'adversarial-review', verification: { challenge: { objections: [{ objection: 'x', disposition: 'maybe' }] } } }), /disposition must be one of fixed, accepted, rejected, open/);
    assert.throws(() => fx.service.promote({ deliverableId: id, to: 'challenged', by: 'adversarial-review', verification: { challenge: { objections: [{ objection: ' ', disposition: 'open' }] } } }), /objection must say what the challenge objected to/);
    assert.throws(() => fx.service.requestPromotion({ deliverableId: id, to: 'challenged', by: 'relayed via claude-code' }), /recorded with the objections it raised, through promote/);
    assert.equal(getDeliverable(fx.store, id)!.trustState, 'validated', 'a refused challenge moves nothing');

    const objections = [{ objection: '  the rename may break an import  ', disposition: 'fixed' }, { objection: 'no test covers the formatter', disposition: 'open' }];
    const challenged = fx.service.promote({ deliverableId: id, to: 'challenged', by: 'adversarial-review', verification: { verdict: 'holds with one open objection', validators: [], challenge: { objections, by: 'someone else', sameSessionAsRun: false } } });
    const v = challenged.verification as { validators?: unknown[]; verdict?: string; challenge: Record<string, unknown> };
    assert.equal(challenged.trustState, 'challenged');
    assert.ok(Array.isArray(v.validators) && v.validators.length > 0, 'what the checks found is kept beside the challenge, whatever the challenger sends');
    assert.equal(v.verdict, 'holds with one open objection');
    assert.deepEqual(v.challenge, {
      objections: [{ objection: 'the rename may break an import', disposition: 'fixed' }, { objection: 'no test covers the formatter', disposition: 'open' }],
      by: 'adversarial-review',
      session: 'sess-1',
      sameSessionAsRun: true,
    });

    // Another session challenging the work is recorded as another session.
    const other = fx.service.start({ workflowId: 'ship', input: { request: 'Rename a private helper in the tax formatter' }, trigger: 'manual' });
    const oc = fx.service.claimNext({ runId: other.run.id });
    const otherId = fx.service.submit({ leased: oc.packet!.leased, output: { summary: 'renamed', findings: [] } }).deliverable!.id;
    const peer = fx.peer({ host: { sessionId: 'sess-2' } });
    const headless = fx.peer({ host: { sessionId: null } });
    try {
      const byPeer = peer.service.promote({ deliverableId: otherId, to: 'challenged', by: 'reviewer', verification: { challenge: { objections: [] } } });
      assert.deepEqual((byPeer.verification as { challenge: unknown }).challenge, { objections: [], by: 'reviewer', session: 'sess-2', sameSessionAsRun: false });
      fx.service.promote({ deliverableId: otherId, to: 'accepted', by: 'gerald', channel: 'tty_cli' });
      const unknown = headless.service.promote({ deliverableId: otherId, to: 'challenged', by: 'runner', verification: { challenge: { objections: [] } } });
      assert.deepEqual((unknown.verification as { challenge: unknown }).challenge, { objections: [], by: 'runner', session: null, sameSessionAsRun: null }, 'an unknown session is not called the same one');
    } finally {
      peer.close();
      headless.close();
    }
  } finally {
    fx.cleanup();
  }
});

test('a waiver the person gives on their own channel is on the deliverable with who gave it and how, the person is told before accepting, and the run is never called validated', () => {
  const fx = fixture();
  try {
    // A declared confidential system whose page the step cites without a recorded read of it.
    addSource(fx.store, { id: 'wiki', kind: 'docs', purpose: 'team wiki', authorityLevel: 'informative', sensitivity: 'confidential', canRead: true, canWrite: false, at: T0 });
    const resolve: RefResolver = (ref) => (ref === 'docs/design.md' ? { ref, kind: 'file', provenance: 'witnessed', path: '/repo/docs/design.md' } : null);
    const unread = [{ ref: 'wiki:cost-model' }];
    const started = fx.service.start({ workflowId: 'review', input: { target: 'waived' }, trigger: 'manual' });
    const first = fx.service.claimNext({ runId: started.run.id });
    fx.service.submit({ leased: first.packet!.leased, output: { notes: 'n' }, evidence: unread, resolve });
    const second = fx.service.claimNext({ runId: started.run.id });
    const spent = fx.service.submit({ leased: second.packet!.leased, output: { notes: 'n' }, evidence: unread, resolve });
    assert.equal(spent.step.state, 'waiting_for_decision');
    const question = fx.service.status(started.run.id)!.openDecisions[0]!;
    assert.deepEqual((question.subject as { validators: string[] }).validators, ['citations_present']);

    fx.service.decide({ decisionId: question.id, resolution: 'accept with these problems', by: 'gerald', channel: 'tty_cli' });
    assert.equal(getDecision(fx.store, question.id)!.channel, 'tty_cli');
    const again = fx.service.claimNext({ runId: started.run.id });
    const told = again.packet!.instructions.join(' ');
    assert.match(told, /The person accepted this step's output with its failing checks \(citations_present\)\. Resubmit the output they reviewed; the deliverable will list these checks as waived and will not be called validated\./);
    assert.doesNotMatch(told, /You relayed/);
    const through = fx.service.submit({ leased: again.packet!.leased, output: { notes: 'n', waived: [], waivedBy: { by: 'forged', channel: 'tty_cli' } }, evidence: unread, resolve });
    assert.equal(through.step.state, 'succeeded');
    const recorded = getStep(fx.store, again.packet!.leased.id)!.output as { waived: { validator: string; problems: string[] }[]; waivedBy: unknown };
    assert.deepEqual(recorded.waived.map((w) => w.validator), ['citations_present']);
    assert.deepEqual(recorded.waivedBy, { by: 'gerald', channel: 'tty_cli' }, 'the kernel records who waived it, not the step');
    const event = listActivity(fx.store, { runId: started.run.id }).find((e) => e.kind === 'step.checks_waived')!;
    assert.deepEqual([(event.payload as { channel: string }).channel, (event.payload as { acceptedBy: string }).acceptedBy], ['tty_cli', 'gerald']);

    const write = fx.service.claimNext({ runId: started.run.id });
    fx.service.submit({ leased: write.packet!.leased, output: { summary: 's', findings: [] }, evidence: [{ ref: 'docs/design.md' }], resolve });
    const record = fx.service.claimNext({ runId: started.run.id });
    const done = fx.service.submit({ leased: record.packet!.leased, output: { recorded: true, waived: [], waivedBy: { by: 'forged', channel: 'tty_cli' } }, resolve });
    assert.equal(done.run.state, 'succeeded');
    assert.equal(done.deliverable!.trustState, 'draft', 'every check passed on the last step, but the run went through on a waiver');
    const body = done.deliverable!.body as { waived: unknown[]; waivedBy?: unknown; sensitivity: string | null };
    assert.equal(body.waivedBy, undefined, 'a waivedBy the step sent is not kept on the deliverable');
    assert.deepEqual(body.waived, [{ stepId: 'gather', validator: 'citations_present', problems: recorded.waived[0]!.problems, acceptedBy: 'gerald', channel: 'tty_cli' }]);
    assert.match(recorded.waived[0]!.problems.join(' '), /wiki:cost-model/);
    assert.equal(body.sensitivity, 'confidential', 'a waived citation of a declared source it holds no read of still carries that source\'s label');
    assert.ok(fx.service.status(started.run.id)!.deliverables.every((d) => Array.isArray((d.body as { waived?: unknown }).waived)), 'every deliverable of the run lists the waiver');

    fx.service.promote({ deliverableId: done.deliverable!.id, to: 'challenged', by: 'adversarial-review', verification: { challenge: { objections: [] } } });
    const asked = fx.service.requestPromotion({ deliverableId: done.deliverable!.id, to: 'accepted', by: 'relayed via claude-code' });
    assert.match(asked.question, /^Move deliverable .* to accepted\? Checks waived on this run, so it was never called validated: citations_present on step gather \(accepted by you\)\.$/);
  } finally {
    fx.cleanup();
  }
});

test('a check that fails anew after a waiver was put to no one, so the person is asked again, and a later call for another attempt ends the waiver', () => {
  const fx = fixture();
  try {
    const started = fx.service.start({ workflowId: 'review', input: { target: 'anew' }, trigger: 'manual' });
    const gather = fx.service.claimNext({ runId: started.run.id });
    fx.service.submit({ leased: gather.packet!.leased, output: { notes: 'n' }, evidence: [{ ref: 'docs/design.md' }] });
    for (let i = 0; i < 2; i++) {
      const w = fx.service.claimNext({ runId: started.run.id });
      fx.service.submit({ leased: w.packet!.leased, output: { summary: '', findings: [] }, evidence: [{ ref: 'docs/design.md' }] });
    }
    const first = fx.service.status(started.run.id)!.openDecisions[0]!;
    assert.deepEqual((first.subject as { validators: string[] }).validators, ['deliverable_complete']);
    fx.service.decide({ decisionId: first.id, resolution: 'accept with these problems', by: 'relayed via claude-code' });
    assert.equal(getDecision(fx.store, first.id)!.channel, 'relay', 'a relayed waiver is recorded as relayed');

    const retry = fx.service.claimNext({ runId: started.run.id });
    assert.match(retry.packet!.instructions.join(' '), /You relayed "accept with these problems"; Construct records that as your relay, not as the person's own answer\. Resubmit the same output; the deliverable will list these checks \(deliverable_complete\) as waived/);
    // The resubmission also fails schema, which no one accepted.
    const anew = fx.service.submit({ leased: retry.packet!.leased, output: { summary: 's' }, evidence: [{ ref: 'docs/design.md' }] });
    assert.equal(anew.step.state, 'waiting_for_decision');
    assert.equal((getStep(fx.store, retry.packet!.leased.id)!.output as unknown), null, 'nothing was recorded as waived');
    const second = fx.service.status(started.run.id)!.openDecisions[0]!;
    assert.notEqual(second.id, first.id);
    assert.deepEqual((second.subject as { validators: string[] }).validators, ['schema', 'deliverable_complete']);

    fx.service.decide({ decisionId: second.id, resolution: 'another attempt', by: 'gerald', channel: 'tty_cli' });
    const fresh = fx.service.claimNext({ runId: started.run.id });
    assert.doesNotMatch(fresh.packet!.instructions.join(' '), /accept with these problems|accepted this step/, 'the latest answer asked for another attempt');
    const fixed = fx.service.submit({ leased: fresh.packet!.leased, output: { summary: 's', findings: [] }, evidence: [{ ref: 'docs/design.md' }] });
    assert.equal(fixed.step.state, 'succeeded');
    assert.equal((fixed.deliverable!.body as { waived?: unknown }).waived, undefined, 'nothing was waived');
  } finally {
    fx.cleanup();
  }
});

test('a step cannot write a waiver for itself: one that found no data keeps none of the waiver keys it sent', () => {
  const fx = fixture();
  try {
    const started = fx.service.start({ workflowId: 'sweep', input: {}, trigger: 'manual' });
    const claimed = fx.service.claimNext({ runId: started.run.id });
    const empty = fx.service.submit({ leased: claimed.packet!.leased, output: { waived: [{ validator: 'citations_present', problems: [] }], waivedBy: { by: 'gerald', channel: 'tty_cli' } }, noData: true });
    assert.equal(empty.step.state, 'succeeded');
    assert.deepEqual(getStep(fx.store, claimed.packet!.leased.id)!.output, { noData: true });
  } finally {
    fx.cleanup();
  }
});
