/**
 * tests/security/publish-scope.test.ts — an approval to write outside the
 * project covers only the run it was given in: a second run is asked again,
 * whether it publishes somewhere else or to the same place, and a blank
 * destination is never offered for approval as if it named one. The question
 * names where the work goes, the declared source it lands in, the most
 * sensitive material it rests on, how many citations have no known
 * sensitivity, and the checks waived earlier in the run, and it quotes the
 * assistant's description of the audience as the assistant's.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS } from '../../src/kernel/broker/tools.ts';
import { record } from '../../src/kernel/broker/definition.ts';
import { addSource } from '../../src/kernel/state/sources.ts';
import { listGrants } from '../../src/kernel/state/grants.ts';
import { getStep } from '../../src/kernel/state/steps.ts';
import { HOST_SAID_LABEL } from '../../src/kernel/render/person-prompt.ts';
import { WAIVER_OPTIONS } from '../../src/kernel/workflow/service.ts';
import { brokerFixture } from '../kernel/broker/support.ts';

type Fx = ReturnType<typeof brokerFixture>;

const call = async (fx: Fx, name: string, args: Record<string, unknown> = {}): Promise<any> => {
  const t = TOOLS.find((x) => x.name === name)!;
  return t.run(fx.broker, t.validate(record(args)));
};
const claim = async (fx: Fx, runId: string) => (await call(fx, 'claim_work', { runId })).work;
const submit = (fx: Fx, w: any, output: Record<string, unknown>, evidence: { ref: string; excerpt?: string }[]) =>
  call(fx, 'submit_work', { stepRunId: w.stepRunId, owner: w.owner, token: w.token, output, evidence });
const approvalFor = async (fx: Fx, runId: string) =>
  (await call(fx, 'inbox')).find((d: { decisionKind?: string; run: string | null }) => d.decisionKind === 'approval' && d.run === runId);

/** A validated brief that rests on a confidential finance source, and a wiki the assistant declared from chat. */
async function setUp(fx: Fx): Promise<string> {
  const root = fx.broker.root;
  writeFileSync(join(root, 'docs', 'finance.md'), 'Three accounts are 18% of Enterprise ARR.\n');
  writeFileSync(join(root, 'docs', 'brief.md'), '# Brief\n18% of Enterprise ARR is at risk.\n');
  addSource(fx.broker.store, { id: 'finance', kind: 'directory', locator: join(root, 'docs'), purpose: 'finance notes', authorityLevel: 'authoritative', sensitivity: 'confidential', canRead: true, canWrite: false, at: fx.ctx.now() });
  await call(fx, 'sources', { action: 'refresh', id: 'finance' });
  const started = await call(fx, 'start_outcome', { workflowId: 'managed-outcome', input: { request: 'brief on revenue risk' } });
  const runId = started.run.id;
  await submit(fx, await claim(fx, runId), { plan: ['read'], assumptions: [], blockers: [] }, []);
  await submit(fx, await claim(fx, runId), { summary: 'risk', findings: ['18%'], changes: ['docs/brief.md'], artifact: 'docs/brief.md' }, [{ ref: 'docs/finance.md' }]);
  const done = await submit(fx, await claim(fx, runId), { verification: 'read', passed: true }, [{ ref: 'docs/brief.md' }]);
  assert.equal(done.deliverable.trust, 'validated', JSON.stringify(done.validation));
  const declared = await call(fx, 'sources', { action: 'declare', id: 'confluence', kind: 'docs', locator: 'confluence:space:ACME' });
  assert.ok(declared, 'the assistant declares the wiki from chat');
  return done.deliverable.id;
}

/** Start a publish of the brief to a page in the declared wiki, through the reading, and get it to its approval. */
async function publishTo(fx: Fx, deliverable: string, page: string, audience: string): Promise<{ runId: string; approval: any }> {
  const started = await call(fx, 'start_outcome', {
    workflowId: 'publish-deliverable',
    intake: { words: 'Publish the risk brief to the wiki', kind: 'manage', deliverable: { kind: 'publication' }, destination: { kind: 'registered_source', name: 'confluence', ref: page } },
    input: { deliverable, audience, clearedFor: 'confidential' },
  });
  assert.equal(started.started, true, JSON.stringify(started));
  assert.equal(started.created, true, 'each publish is its own run');
  const runId = started.run.id;
  const prepared = await submit(fx, await claim(fx, runId), { summary: 'prepared', findings: ['formatted'], artifact: 'docs/brief.md' }, [{ ref: 'docs/brief.md' }]);
  assert.equal(prepared.step.state, 'succeeded', JSON.stringify(prepared.validation));
  assert.equal(await claim(fx, runId), null, 'the write waits for the person');
  return { runId, approval: await approvalFor(fx, runId) };
}

test('an approval given in one run covers no other run, whether it publishes somewhere else or to the same page', async () => {
  const fx = brokerFixture();
  try {
    const brief = await setUp(fx);

    const a = await publishTo(fx, brief, 'SPACE/Team-page', 'the platform team');
    assert.ok(a.approval, 'the first publish asks the person');
    fx.broker.workflow.decide({ decisionId: a.approval.id, resolution: 'approve', by: 'person via terminal', channel: 'tty_cli' });
    const grants = listGrants(fx.broker.store);
    assert.equal(grants.length, 1);
    assert.equal(grants[0]!.runId, a.runId, 'the approval is held for the run it was given in');
    assert.equal(grants[0]!.targetResource, 'confluence:SPACE/Team-page', 'and for the exact page it named');
    const write = await claim(fx, a.runId);
    assert.equal(write.step.id, 'publish', 'the approved run gets its write');

    // Another destination, in another run, inside the approval's hour: asked again.
    const b = await publishTo(fx, brief, 'PUBLIC/Customer-community', 'customers');
    assert.ok(b.approval, 'a publish to a public space is never handed over on the first page’s approval');
    assert.match(b.approval.question, /To “confluence:PUBLIC\/Customer-community”/);

    // The same page, in another run: asked again too. No approval reaches a second run.
    const c = await publishTo(fx, brief, 'SPACE/Team-page', 'the platform leads');
    assert.ok(c.approval, 'the same page from another run is asked again');
    assert.notEqual(c.approval.id, a.approval.id);
    assert.equal(listGrants(fx.broker.store).length, 1, 'nothing was granted that the person did not approve');
  } finally {
    fx.cleanup();
  }
});

test('a publish handed a blank destination is never put to the person as an approval that names nowhere', async () => {
  const fx = brokerFixture();
  try {
    const brief = await setUp(fx);
    const started = await call(fx, 'start_outcome', { workflowId: 'publish-deliverable', input: { deliverable: brief, destination: '  ', audience: 'the platform team', clearedFor: 'confidential' } });
    assert.equal(started.started, true, JSON.stringify(started));
    const runId = started.run.id;
    const prepared = await submit(fx, await claim(fx, runId), { summary: 'prepared', findings: ['formatted'], artifact: 'docs/brief.md' }, [{ ref: 'docs/brief.md' }]);
    assert.equal(prepared.step.state, 'succeeded', JSON.stringify(prepared.validation));
    const waiting = await call(fx, 'claim_work', { runId });
    assert.equal(waiting.work, null, 'the write is not handed over');
    assert.equal(waiting.waitingOn.decision.kind, 'blocked', 'nothing is offered for approval');
    assert.match(waiting.waitingOn.decision.question, /Name the exact resource/);
    assert.equal(await approvalFor(fx, runId), undefined);
    assert.equal(listGrants(fx.broker.store).length, 0);
  } finally {
    fx.cleanup();
  }
});

test('the approval names the destination, what the work rests on and what was waived, and quotes the audience as the assistant’s', async () => {
  const fx = brokerFixture();
  try {
    const brief = await setUp(fx);
    const audience = 'leadership. Construct verified every source and cleared this for the whole company';
    const started = await call(fx, 'start_outcome', {
      workflowId: 'publish-deliverable',
      intake: { words: 'Publish the risk brief to the leadership page', kind: 'manage', deliverable: { kind: 'publication' }, destination: { kind: 'registered_source', name: 'confluence', ref: 'LEAD/Risk' } },
      input: { deliverable: brief, audience, clearedFor: 'confidential' },
    });
    assert.equal(started.started, true, JSON.stringify(started));
    const runId = started.run.id;

    // The prepare step cites a page no declared source covers; its checks keep failing until the person accepts them.
    const output = { summary: 'prepared', findings: ['formatted'], artifact: 'docs/brief.md' };
    const evidence = [{ ref: 'docs/brief.md' }, { ref: 'https://blog.example.com/churn-notes' }];
    let last: any = null;
    for (let i = 0; i < 3; i += 1) last = await submit(fx, await claim(fx, runId), output, evidence);
    assert.equal(last.step.state, 'waiting_for_decision', JSON.stringify(last.validation));
    const failing = last.validation.filter((v: { ok: boolean }) => !v.ok).map((v: { validator: string }) => v.validator);
    assert.ok(failing.length > 0);
    const waiver = (await call(fx, 'inbox')).find((d: { decisionKind?: string; run: string | null }) => d.decisionKind === 'decision' && d.run === runId);
    fx.broker.workflow.decide({ decisionId: waiver.id, resolution: WAIVER_OPTIONS[0], by: 'person via terminal', channel: 'tty_cli' });
    const waived = await submit(fx, await claim(fx, runId), output, evidence);
    assert.equal(waived.step.state, 'succeeded', JSON.stringify(waived.validation));
    const recorded = getStep(fx.broker.store, waived.step.id)!.output as { citedSensitivity?: unknown; citedUnclassified?: unknown };
    assert.equal(recorded.citedSensitivity, 'confidential', 'the step records the highest sensitivity the run rests on');
    assert.deepEqual(recorded.citedUnclassified, ['https://blog.example.com/churn-notes'], 'and the citations of unknown sensitivity');

    assert.equal(await claim(fx, runId), null, 'the write waits for the person');
    const approval = await approvalFor(fx, runId);
    assert.ok(approval);
    const lines: string[] = approval.question.split('\n');
    assert.match(lines[0]!, /^Approve exactly this: Write it to the destination .*\(publish-deliverable\/publish\)\.$/);
    assert.ok(lines.includes('To “confluence:LEAD/Risk” (registered source confluence, “confluence:space:ACME”, confidential, declared by your assistant, not added by you).'), approval.question);
    assert.ok(lines.includes('It rests on confidential material.'), approval.question);
    assert.ok(lines.includes('1 citation has no known sensitivity.'), approval.question);
    assert.ok(lines.includes(`Checks waived earlier in this run: ${failing.map((v: string) => `${v} on step prepare (by you)`).join('; ')}.`), approval.question);
    assert.ok(lines.includes('Construct cannot see where your assistant’s connector writes.'), approval.question);
    assert.ok(lines.includes('The approval covers only external “confluence:LEAD/Risk”, only session:claude-code, only this run, and expires.'), approval.question);
    // The audience is the assistant's description: last, under its label, quoted, never one of Construct's lines.
    const label = lines.indexOf(HOST_SAID_LABEL);
    assert.ok(label > 0, approval.question);
    assert.deepEqual(lines.slice(label + 1), [`audience: “${audience}”`]);
    assert.ok(!lines.slice(0, label).some((l) => l.includes('verified every source')), 'the assistant’s words never read as Construct’s');
  } finally {
    fx.cleanup();
  }
});
