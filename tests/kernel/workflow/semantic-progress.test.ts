import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { freshStore } from '../state/support.ts';
import { tmp, writeWorkflow, workflowManifest, step } from '../registry/support.ts';
import { createSkillRegistry } from '../../../src/kernel/registry/skill-registry.ts';
import { createWorkflowRegistry } from '../../../src/kernel/registry/workflow-registry.ts';
import { updateLock } from '../../../src/kernel/registry/lockfile.ts';
import { emptyLock } from '../../../src/kernel/project/lock.ts';
import { createWorkflowService } from '../../../src/kernel/workflow/service.ts';
import { appendActivity } from '../../../src/kernel/state/activity.ts';
import { readPreparedReview, type NativeReviewerIdentity, type SemanticWitness } from '../../../src/kernel/workflow/semantic-review.ts';
import { upsertDraft } from '../../../src/kernel/state/deliverables.ts';
import { brokerFixture } from '../broker/support.ts';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { record } from '../../../src/kernel/broker/definition.ts';

// Synthetic state-machine evidence only: this fixture never invokes a model.
function fixture(supported = true, inherited = false) {
  const fx = freshStore(), dir = tmp();
  writeWorkflow(join(dir.root, 'workflows'), 'probe', workflowManifest('probe', '1.0.0', inherited ? [step('do', { tier: 'project_write', capabilities: ['write_project_files'], outputs: ['summary'] }), step('final', { needs: ['do'], inputs: { summary: 'steps.do.summary' }, outputs: ['verification'] })] : [step('final', { outputs: ['summary'] })], { inputSchema: { request: 'string' }, requiredInputs: ['request'], deliverable: { kind: 'outcome', schema: 'outcome/v1', challenge: false }, cancellation: 'after_step' }));
  const skills = createSkillRegistry({ builtinDir: join(dir.root, 'skills'), projectDir: null });
  const workflows = createWorkflowRegistry({ builtinDir: join(dir.root, 'workflows'), projectDir: null });
  const host = { hostId: 'codex', sessionId: 'producer-session', executorId: 'producer', available: new Set(['read_project_context', 'write_project_files']), maxTier: 'project_write' as const, restrictions: [], budgetCents: null };
  const pin: NativeReviewerIdentity = { host: 'codex', binary: 'synthetic-never-executed', digest: 'synthetic', version: 'codex-cli 0.145.0', profile: 'codex-held-text-v1' };
  let n = 0, time = Date.parse('2026-10-10T12:00:00Z'), source = 'Observed value is eight.';
  const now = () => new Date(time).toISOString();
  const resolve = (ref: string) => ref === 'source' ? { ref, kind: 'file' as const, provenance: 'witnessed' as const, text: source } : null;
  const service = createWorkflowService({ store: fx.store, skills, workflows, host, lock: updateLock(emptyLock(), skills.list(), workflows.list()).lock, now, nextId: p => `${p}-${++n}`, sources: () => [], projectWritePolicy: 'managed', resolveEvidence: resolve, semanticReviewer: supported ? pin : null });
  const run = service.start({ workflowId: 'probe', input: { request: 'Assess the supplied evidence' }, trigger: 'manual' }).run;
  const first = service.claimNext({ runId: run.id }).packet!.leased;
  const evidence = [{ ref: 'source' }];
  if (inherited) service.submit({ leased: first, output: { summary: 'Incorrect inherited assessment.' }, evidence });
  const leased = inherited ? service.claimNext({ runId: run.id }).packet!.leased : first;
  const output: Record<string, unknown> = inherited ? { verification: 'Draft checked.' } : { summary: 'The observed value is eight.' };
  const submit = (value = output) => service.submit({ leased, output: value, evidence });
  const progress = () => service.status(run.id)!.semanticReview;
  const observe = (ref: string, patch: Partial<SemanticWitness> = {}, channel = 'host_semantic') => {
    const p = readPreparedReview(fx.store, ref)!;
    appendActivity(fx.store, { at: now(), kind: 'semantic.executed', channel, runId: run.id, stepRunId: leased.id, payload: { preparedRef: p.ref, bundleDigest: p.digest, attempt: leased.token, invocation: { id: 'synthetic', host: pin.host, hostVersion: pin.version, model: 'synthetic', sessionId: 'synthetic-independent-session', completed: true, exitStatus: 0, timedOut: false, transcriptDigest: 'synthetic' }, judgment: { checks: p.bundle.contract.obligations.map(o => ({ id: o.id, verdict: 'pass', reason: 'Synthetic state-machine observation only.', refs: ['body'] })) }, problems: [], ...patch } });
  };
  return { ...fx, service, run, leased, output, evidence, submit, progress, observe, now, setSource(s: string) { source = s; }, tick(ms: number) { time += ms; }, cleanup() { fx.cleanup(); dir.cleanup(); } };
}

test('unsupported review is disclosed before work and does not invite unsupported command retries', () => {
  const f = fixture(false);
  try {
    assert.equal(f.progress().state, 'unavailable');
    const result = f.submit();
    assert.equal(result.semanticReview!.state, 'unavailable');
    assert.equal(result.semanticReview!.canInvoke, false);
    assert.match(result.semanticReview!.next, /report it as unverified/);
    assert.doesNotMatch(result.semanticReview!.next, /run construct run review/);
    assert.equal(result.deliverable!.trustState, 'draft');
    assert.equal(result.step.state, 'leased');
  } finally { f.cleanup(); }
});

test('public start, claim and run status carry the same unavailable boundary without starting a reviewer', () => {
  const f = brokerFixture('interactive', { semanticReview: 'none' });
  try {
    const call = (name: string, args: Record<string, unknown>) => { const t = TOOLS.find(t => t.name === name)!; return t.run(f.broker, t.validate(record(args))) as any; };
    const started = call('start_outcome', { workflowId: 'managed-outcome', input: { request: 'Draft a bounded design note.' } });
    assert.equal(started.semanticReview.state, 'unavailable');
    assert.equal(call('claim_work', { runId: started.run.id }).work.semanticReview.state, 'unavailable');
    assert.equal(call('run_status', { runId: started.run.id }).semanticReview.state, 'unavailable');
    assert.equal((f.broker.store.db.prepare("SELECT count(*) AS n FROM activity_events WHERE kind LIKE 'semantic.%'").get() as { n: number }).n, 0);
  } finally { f.cleanup(); }
});

test('one dispatch is visible without claiming it completed; status reads create no events', () => {
  const f = fixture();
  try {
    assert.equal(f.progress().state, 'not_prepared');
    const p = f.submit().semanticReview!;
    assert.equal(p.state, 'needs_review'); assert.equal(p.canInvoke, true);
    f.observe(p.preparedRef!, {}, 'relay');
    assert.equal(f.progress().state, 'needs_review', 'producer claims do not establish an observed review');
    appendActivity(f.store, { at: f.now(), kind: 'semantic.dispatched', channel: 'host_semantic', runId: f.run.id, stepRunId: f.leased.id, payload: { preparedRef: p.preparedRef } });
    const count = () => (f.store.db.prepare('SELECT count(*) AS n FROM activity_events').get() as { n: number }).n;
    const before = count();
    assert.equal(f.progress().state, 'dispatched'); assert.equal(f.progress().canInvoke, false);
    assert.match(f.progress().next, /Do not launch it again/);
    assert.equal(count(), before);
    f.tick(30 * 60_000);
    assert.equal(f.progress().state, 'stale');
  } finally { f.cleanup(); }
});

test('rejected content returns actionable findings, preserves its draft and requires a new generation', () => {
  const f = fixture();
  try {
    const first = f.submit(), p = readPreparedReview(f.store, first.semanticReview!.preparedRef!)!;
    f.observe(p.ref, { judgment: { checks: p.bundle.contract.obligations.map(o => ({ id: o.id, verdict: o.id === 'reasoning' ? 'fail' : 'pass', reason: o.id === 'reasoning' ? 'The counterfactual reverses its comparison.' : 'Synthetic control.', refs: ['body'] })) } });
    const progress = f.progress();
    assert.equal(progress.state, 'rejected'); assert.equal(progress.canInvoke, false);
    assert.match(progress.checks.find(c => c.id === 'reasoning')!.reason, /reverses/);
    assert.match(progress.next, /Repair the material findings/);
    const unchanged = f.submit();
    assert.equal(unchanged.semanticReview!.state, 'rejected');
    assert.equal(unchanged.deliverable!.id, first.deliverable!.id); assert.equal(unchanged.deliverable!.trustState, 'draft');
    const revised = { summary: 'Corrected supported assessment.' }, next = f.submit(revised);
    assert.equal(next.semanticReview!.state, 'needs_review');
    assert.notEqual(next.semanticReview!.preparedRef, p.ref);
    f.observe(next.semanticReview!.preparedRef!);
    assert.equal(f.progress().state, 'passed');
    assert.equal(f.submit(revised).run.state, 'succeeded');
    assert.equal(f.progress().state, 'passed');
  } finally { f.cleanup(); }
});

test('failed invocation, source change, cancellation and draft replacement cannot appear passed or callable', () => {
  const f = fixture();
  try {
    const first = f.submit();
    f.observe(first.semanticReview!.preparedRef!, { problems: ['native process failed'] });
    assert.equal(f.progress().state, 'review_failed'); assert.equal(f.progress().canInvoke, false);
    f.observe(first.semanticReview!.preparedRef!);
    assert.equal(f.progress().state, 'passed');
    f.setSource('The same provider timestamp now describes four.');
    assert.equal(f.progress().state, 'stale');
    f.setSource('Observed value is eight.');
    upsertDraft(f.store, { id: first.deliverable!.id, runId: f.run.id, stepRunId: f.leased.id, kind: 'outcome', body: { summary: 'Different body' }, at: f.now() });
    assert.equal(f.progress().state, 'stale');
    f.service.cancel({ runId: f.run.id, by: 'fixture', reason: 'Stop' });
    assert.equal(f.progress().state, 'cancelling');
    assert.match(f.progress().next, /submit its held output once/);
    assert.equal(f.progress().canInvoke, false);
    assert.equal(f.submit().run.state, 'cancelled');
    assert.equal(f.progress().state, 'stopped');
  } finally { f.cleanup(); }
});

test('unsupported oversized drafts keep reviewer unavailability visible', () => {
  const f = fixture(false);
  try {
    const result = f.submit({ summary: 'x'.repeat(2_200_000) });
    assert.equal(result.semanticReview!.state, 'unavailable');
    assert.equal(f.progress().state, 'unavailable');
    assert.equal(result.semanticReview!.canInvoke, false);
    assert.match(result.semanticReview!.problems.join(' '), /No supported native reviewer/);
    assert.match(result.semanticReview!.problems.join(' '), /limit.*2 MiB/);
    assert.equal(result.deliverable!.trustState, 'draft');
    assert.equal(result.step.state, 'leased');
  } finally { f.cleanup(); }
});

test('malformed or wrongly bound observations remain non-callable failures, even with a negative judgment', () => {
  for (const patch of [{ invocation: null }, { problems: null }, { attempt: 999 }, { problems: [42] }, { invocation: { completed: true, exitStatus: 0, timedOut: false, host: 'cursor', hostVersion: 'wrong' } }]) {
    const f = fixture();
    try {
      const first = f.submit(), ref = first.semanticReview!.preparedRef!, p = readPreparedReview(f.store, ref)!;
      f.observe(ref, { ...patch, judgment: { checks: p.bundle.contract.obligations.map(o => ({ id: o.id, verdict: 'fail', reason: 'A negative judgment must not mask invalid invocation.', refs: ['body'] })) } } as unknown as Partial<SemanticWitness>);
      assert.equal(f.progress().state, 'review_failed');
      assert.equal(f.progress().canInvoke, false);
      assert.equal(f.submit().semanticReview!.state, 'review_failed');
      assert.equal(f.submit().deliverable!.trustState, 'draft');
    } finally { f.cleanup(); }
  }
  const f = fixture();
  try {
    const first = f.submit();
    f.observe(first.semanticReview!.preparedRef!, { judgment: { checks: [{ id: 'reasoning', verdict: 'fail', reason: 'Other obligations are missing.', refs: ['body'] }] } });
    assert.equal(f.progress().state, 'review_failed');
  } finally { f.cleanup(); }
});

test('inherited bad output cannot be repaired in observe-only verification; cancellation permits a new bounded attempt', () => {
  const f = fixture(true, true);
  try {
    const first = f.submit(), p = readPreparedReview(f.store, first.semanticReview!.preparedRef!)!;
    f.observe(p.ref, { judgment: { checks: p.bundle.contract.obligations.map(o => ({ id: o.id, verdict: o.id === 'reasoning' ? 'fail' : 'pass', reason: 'The earlier assessment requires correction.', refs: ['body'] })) } });
    const rejected = f.progress();
    assert.equal(rejected.state, 'rejected');
    assert.match(rejected.next, /tier is observe/);
    assert.match(rejected.next, /Inherited fields \(summary\) are frozen/);
    assert.match(rejected.next, /construct run cancel/);
    const refusedCorrection = f.submit({ ...f.output, summary: 'Attempted replacement of inherited summary.' });
    assert.equal(refusedCorrection.semanticReview!.preparedRef, p.ref);
    assert.equal((refusedCorrection.deliverable!.body as any).summary, 'Incorrect inherited assessment.');
    f.service.cancel({ runId: f.run.id, by: 'fixture', reason: 'semantic repair requires replanning' });
    assert.equal(f.submit().run.state, 'cancelled');
    const replacement = f.service.start({ workflowId: 'probe', input: { request: 'Assess the supplied evidence' }, trigger: 'manual' });
    assert.equal(replacement.created, true);
    assert.notEqual(replacement.run.id, f.run.id);
    const rework = f.service.claimNext({ runId: replacement.run.id }).packet!;
    assert.equal(rework.step.id, 'do');
    assert.equal(rework.step.tier, 'project_write');
    assert.equal(first.deliverable!.trustState, 'draft');
    assert.equal(f.service.status(f.run.id)!.deliverables.at(-1)!.trustState, 'draft');
  } finally { f.cleanup(); }
});

test('actual adapter-shaped negative problems retain rejection while unrelated failures do not', () => {
  const f = fixture();
  try {
    const first = f.submit(), p = readPreparedReview(f.store, first.semanticReview!.preparedRef!)!;
    const judgment = { checks: p.bundle.contract.obligations.map(o => ({ id: o.id, verdict: o.id === 'reasoning' ? 'fail' : 'pass', reason: 'Independent assessment of the held artifact.', refs: ['body'] })) };
    f.observe(p.ref, { judgment, problems: ['reasoning: fail review judgment'] });
    assert.equal(f.progress().state, 'rejected');
    assert.match(f.progress().next, /Repair the material findings/);
    assert.equal(f.submit().semanticReview!.state, 'rejected');
    f.observe(p.ref, { judgment, problems: ['reasoning: fail review judgment', 'native host MCP configuration changed during review'] });
    assert.equal(f.progress().state, 'review_failed');
    assert.equal(f.progress().canInvoke, false);
    assert.equal(f.submit().deliverable!.trustState, 'draft');
  } finally { f.cleanup(); }
});

test('cancellation with an expired lease directs recovery instead of impossible acknowledgment', () => {
  const f = fixture();
  try {
    const first = f.submit();
    f.tick(31 * 60_000);
    f.service.cancel({ runId: f.run.id, by: 'fixture', reason: 'Stop expired review attempt' });
    assert.equal(f.progress().state, 'cancelling');
    assert.equal(f.progress().canInvoke, false);
    assert.match(f.progress().next, /Call claim_work/);
    assert.doesNotMatch(f.progress().next, /submit its held output once/);
    assert.equal(f.service.claimNext({ runId: f.run.id }).packet, null);
    assert.equal(f.service.status(f.run.id)!.run.state, 'cancelled');
    assert.equal(f.progress().state, 'stopped');
    assert.equal(f.service.status(f.run.id)!.deliverables.at(-1)!.id, first.deliverable!.id);
    assert.equal(f.service.status(f.run.id)!.deliverables.at(-1)!.trustState, 'draft');
  } finally { f.cleanup(); }
});
