/**
 * tests/kernel/broker/remaining-gaps.test.ts — the journeys that were left
 * open: a decision that rules things out is enforced, work resting on
 * confidential sources is cleared before it leaves, publishing is a gated
 * write with a recorded location, skill impact is measured from runs, and
 * questions reach the person who decides them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS, ownerFor } from '../../../src/kernel/broker/tools.ts';
import { record } from '../../../src/kernel/broker/definition.ts';
import { addSource } from '../../../src/kernel/state/sources.ts';
import { skillQuality } from '../../../src/kernel/state/quality.ts';
import { brokerFixture } from './support.ts';

const call = async (fx: ReturnType<typeof brokerFixture>, name: string, args: Record<string, unknown> = {}): Promise<any> => {
  const t = TOOLS.find((x) => x.name === name)!;
  return t.run(fx.broker, t.validate(record(args)));
};
const step = async (fx: ReturnType<typeof brokerFixture>, runId: string) => (await call(fx, 'claim_work', { runId })).work;
const submit = (fx: ReturnType<typeof brokerFixture>, w: any, output: Record<string, unknown>, evidence: { ref: string; excerpt?: string }[]) =>
  call(fx, 'submit_work', { stepRunId: w.stepRunId, owner: w.owner, token: w.token, output, evidence });

test('a decision that rules terms out is enforced in answers and in work once the person confirms it, unless the text says it was decided against', async () => {
  const fx = brokerFixture();
  try {
    writeFileSync(join(fx.broker.root, 'docs', 'rfc.md'), 'Delivery guarantee: exactly-once.\n');
    const r = await call(fx, 'remember', { kind: 'decision', text: 'Webhooks use at-least-once delivery with event_id dedupe.', contradicts: ['exactly-once'] });
    assert.equal(r.remembered.voice, 'relayed');
    assert.equal(r.personRequired, true);
    assert.match(r.next, new RegExp(`construct inbox resolve ${r.pending.decisionId} approve`));
    const relayed = await call(fx, 'check_answer', { answer: 'Webhooks guarantee exactly-once delivery.', citations: [{ ref: 'docs/rfc.md' }] });
    assert.ok(!relayed.problems.some((p: { check: string }) => p.check === 'settled_not_contradicted'), 'a rule the person has not confirmed restricts nothing');
    fx.broker.workflow.decide({ decisionId: r.pending.decisionId, resolution: 'approve', by: 'person via cli', channel: 'tty_cli' });
    const bad = await call(fx, 'check_answer', { answer: 'Webhooks guarantee exactly-once delivery.', citations: [{ ref: 'docs/rfc.md' }] });
    assert.ok(bad.problems.some((p: { check: string }) => p.check === 'settled_not_contradicted'));
    const ok = await call(fx, 'check_answer', { answer: 'The old RFC said exactly-once, which was decided against; delivery is at-least-once.', citations: [{ ref: 'docs/rfc.md' }] });
    assert.ok(!ok.problems.some((p: { check: string }) => p.check === 'settled_not_contradicted'), JSON.stringify(ok.problems));
  } finally {
    fx.cleanup();
  }
});

test('work resting on confidential sources carries that label, and publishing it needs the person to clear it, then an approved write, then a location', async () => {
  const fx = brokerFixture();
  try {
    const s = fx.broker.store;
    const at = fx.ctx.now();
    const root = fx.broker.root;
    writeFileSync(join(root, 'docs', 'finance.md'), 'Three accounts are 18% of Enterprise ARR.\n');
    writeFileSync(join(root, 'docs', 'brief.md'), '# Brief\n18% of Enterprise ARR is at risk.\n');
    addSource(s, { id: 'finance', kind: 'directory', locator: join(root, 'docs'), purpose: 'finance notes', authorityLevel: 'authoritative', sensitivity: 'confidential', canRead: true, canWrite: false, at });
    await call(fx, 'sources', { action: 'refresh', id: 'finance' });
    const started = await call(fx, 'start_outcome', { workflowId: 'managed-outcome', input: { request: 'brief on revenue risk' } });
    const runId = started.run.id;
    await submit(fx, await step(fx, runId), { plan: ['read'], assumptions: [], blockers: [] }, []);
    await submit(fx, await step(fx, runId), { summary: 'risk', findings: ['18%'], changes: ['docs/brief.md'], artifact: 'docs/brief.md' }, [{ ref: 'docs/finance.md' }]);
    const done = await submit(fx, await step(fx, runId), { verification: 'read', passed: true }, [{ ref: 'docs/brief.md' }]);
    assert.equal(done.deliverable.trust, 'validated', JSON.stringify(done.validation));
    const status = await call(fx, 'run_status', { runId });
    assert.equal(status.deliverables.at(-1).body.sensitivity, 'confidential');
    assert.equal(status.deliverables.at(-1).body.artifact, 'docs/brief.md', 'the deliverable carries the file the work produced');

    const uncleared = await call(fx, 'start_outcome', { workflowId: 'publish-deliverable', input: { deliverable: done.deliverable.id, destination: 'notion:Product/Webhooks', audience: 'whole company' } });
    const prep = await submit(fx, await step(fx, uncleared.run.id), { summary: 'prepared', findings: ['formatted'], artifact: 'docs/brief.md' }, [{ ref: 'docs/brief.md' }]);
    assert.ok(prep.validation.some((v: { validator: string; ok: boolean }) => v.validator === 'sensitivity_cleared' && !v.ok));

    const cleared = await call(fx, 'start_outcome', { workflowId: 'publish-deliverable', input: { deliverable: done.deliverable.id, destination: 'notion:Product/Webhooks', audience: 'leadership', clearedFor: 'confidential' } });
    const p2 = await submit(fx, await step(fx, cleared.run.id), { summary: 'prepared', findings: ['formatted'], artifact: 'docs/brief.md' }, [{ ref: 'docs/brief.md' }]);
    assert.equal(p2.step.state, 'succeeded', JSON.stringify(p2.validation));
    const waiting = await call(fx, 'claim_work', { runId: cleared.run.id });
    assert.equal(waiting.work, null, 'the external write waits for the person');
    const approval = (await call(fx, 'inbox')).find((d: { decisionKind?: string; run: string }) => d.decisionKind === 'approval' && d.run === cleared.run.id);
    assert.ok(approval, 'an approval for exactly this write is in the inbox');
    // The person sees where it goes, who it is for in the assistant's words, and the most sensitive material it rests on.
    assert.match(approval.question, /^To “notion:Product\/Webhooks”\.$/m);
    assert.match(approval.question, /^audience: “leadership”$/m);
    assert.match(approval.question, /^It rests on confidential material\.$/m);
    assert.match(approval.question, /covers only external “notion:Product\/Webhooks”, only session:claude-code, only this run, and expires\.$/m);
    const relayed = await call(fx, 'decide', { decisionId: approval.id, resolution: 'approve' });
    assert.equal(relayed.personRequired, true, 'a write that leaves the project is the person\'s own answer, never a relayed one');
    fx.broker.workflow.decide({ decisionId: approval.id, resolution: 'approve', by: 'person via terminal', channel: 'tty_cli' });
    const pub = await step(fx, cleared.run.id);
    assert.equal(pub.step.id, 'publish');
    const noLoc = await submit(fx, pub, { summary: 'posted' }, []);
    assert.ok(noLoc.validation.some((v: { validator: string; ok: boolean }) => v.validator === 'published_location' && !v.ok));
    const posted = await submit(fx, await step(fx, cleared.run.id), { summary: 'posted', location: 'https://notion.so/Product/Webhooks-abc' }, []);
    assert.equal(posted.step.state, 'succeeded', JSON.stringify(posted.validation));
  } finally {
    fx.cleanup();
  }
});

test('skill impact is measured from runs: first-pass rate, attempts, and which checks sent steps back', async () => {
  const fx = brokerFixture();
  try {
    writeFileSync(join(fx.broker.root, 'docs', 'notes.md'), 'Polling hurts.\n');
    const started = await call(fx, 'start_outcome', { workflowId: 'prd-authoring', input: { request: 'PRD', target: 'docs/prd.md' } });
    const runId = started.run.id;
    await submit(fx, await step(fx, runId), { summary: 's', findings: ['f'], material: [] }, [{ ref: 'docs/notes.md' }]);
    await submit(fx, await step(fx, runId), { summary: 's', findings: ['f'], material: [], conflicts: [], unknowns: [] }, [{ ref: 'docs/notes.md' }]);
    const q = skillQuality(fx.broker.store, { skill: 'context-mapping' });
    assert.equal(q.length, 1);
    assert.equal(q[0]!.steps, 1);
    assert.equal(q[0]!.firstPass, 0);
    assert.equal(q[0]!.meanAttempts, 2);
    assert.equal(q[0]!.failingChecks[0]!.validator, 'conflicts_declared');
    const viaTool = await call(fx, 'project_context', { topic: 'quality' });
    assert.ok(viaTool.items.some((r: { skill: string }) => r.skill === 'context-mapping'), 'the quality topic pages like every other topic');
  } finally {
    fx.cleanup();
  }
});

test('questions route to the owner the constitution names for that area', () => {
  const owners = [{ name: 'Leo Marsh', decides: ['pricing', 'scope'] }, { name: 'Priya Nair', decides: ['delivery semantics', 'jira-int'] }];
  assert.equal(ownerFor(owners, 'notes gained pricing-sync.md; revise?'), 'Leo Marsh');
  assert.equal(ownerFor(owners, 'jira-int: INT-203 changed'), 'Priya Nair');
  assert.equal(ownerFor(owners, 'something else'), null);
});
