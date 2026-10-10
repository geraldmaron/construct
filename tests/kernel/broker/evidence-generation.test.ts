import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { record } from '../../../src/kernel/broker/definition.ts';
import { getRun } from '../../../src/kernel/state/runs.ts';
import { getStep, listSteps } from '../../../src/kernel/state/steps.ts';
import { getWork } from '../../../src/kernel/work/service.ts';
import { listLiveLeases } from '../../../src/kernel/work/leases.ts';
import { brokerFixture, observedVerification, type BrokerFixture } from './support.ts';
import { contentReceipt } from '../../../src/kernel/workflow/verification.ts';
import { projectResolver } from '../../../src/kernel/source/resolver.ts';

const call = async (fx: BrokerFixture, name: string, args: Record<string, unknown>): Promise<any> => {
  const tool = TOOLS.find((t) => t.name === name)!;
  return Promise.resolve(tool.run(fx.broker, tool.validate(record(args))));
};
const request = { workflowId: 'managed-outcome', intake: { kind: 'manage', words: 'Review current policy and save a brief.', deliverable: { kind: 'other', describe: 'policy brief' }, destination: { kind: 'project_file', ref: 'brief.md' } } };
const claim = (fx: BrokerFixture, runId: string) => call(fx, 'claim_work', { runId }).then((r) => r.work);
const submit = (fx: BrokerFixture, w: any, output: Record<string, unknown>, more = {}) => call(fx, 'submit_work', { stepRunId: w.stepRunId, token: w.token, output, evidence: [{ ref: 'docs/design.md' }], ...more });
const old = 'The export contains personal email addresses.';
const current = 'The export does not contain personal email addresses.';
async function produced(fx: BrokerFixture) {
  writeFileSync(join(fx.box.cwd, 'docs/design.md'), old);
  const started = await call(fx, 'start_outcome', request);
  await submit(fx, await claim(fx, started.run.id), { plan: ['Read current policy and write brief'], assumptions: [], blockers: [] });
  const doing = await claim(fx, started.run.id);
  writeFileSync(join(fx.box.cwd, 'brief.md'), old);
  const result = await submit(fx, doing, { summary: old, findings: [old], changes: [], artifact: 'brief.md' });
  assert.equal(result.step.state, 'succeeded');
  return started.run.id;
}
for (const change of ['changed', 'deleted'] as const) test(`${change} consumed evidence stops the next claim and releases delivery without rebinding old analysis`, async () => {
  const fx = brokerFixture();
  try {
    const id = await produced(fx);
    const before = listSteps(fx.broker.store, id).filter((s) => s.state === 'succeeded').map((s) => JSON.stringify(s.output));
    if (change === 'changed') writeFileSync(join(fx.box.cwd, 'docs/design.md'), current);
    else unlinkSync(join(fx.box.cwd, 'docs/design.md'));
    const next = await call(fx, 'claim_work', { runId: id });
    assert.equal(next.work, null);
    assert.match(next.waitingOn.reason, /Previously consumed evidence changed/);
    assert.equal(getRun(fx.broker.store, id)!.state, 'failed');
    assert.deepEqual(listSteps(fx.broker.store, id).filter((s) => s.state === 'succeeded').map((s) => JSON.stringify(s.output)), before);
    assert.equal(readFileSync(join(fx.box.cwd, 'brief.md'), 'utf8'), old);
    assert.equal(listLiveLeases(fx.broker.store, fx.ctx.now()).length, 0);
    assert.notEqual(getWork(fx.broker.store, `work-${id}-delivery`)!.status, 'completed');
  } finally { fx.cleanup(); }
});
for (const noData of [false, true]) test(`drift during a leased verification cannot be waived by a passing command or noData=${noData}`, async () => {
  const fx = brokerFixture();
  try {
    const id = await produced(fx), w = await claim(fx, id);
    const observed = await observedVerification(fx, w);
    writeFileSync(join(fx.box.cwd, 'docs/design.md'), current);
    const final = await submit(fx, w, { verification: observed, passed: true }, { noData });
    assert.equal(final.run.state, 'failed');
    assert.equal(final.validation.find((v: any) => v.validator === 'evidence_generation').ok, false);
    assert.equal(final.deliverable, null);
    assert.equal(getStep(fx.broker.store, w.stepRunId)!.output, null);
    await assert.rejects(submit(fx, w, { verification: observed }), /not held by this session/);
    const retry = await call(fx, 'start_outcome', request);
    assert.notEqual(retry.run.id, id);
    assert.equal((await claim(fx, retry.run.id)).step.id, 'plan', 'ordinary request derives a fresh generation');
    const original = getRun(fx.broker.store, id)!;
    const duplicate = fx.broker.workflow.start({ workflowId: original.workflowId, input: original.input as Record<string, unknown>, trigger: original.triggerKind, idempotencyKey: original.idempotencyKey });
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.run.id, id, 'an explicit occurrence key never silently repeats completed effects');
  } finally { fx.cleanup(); }
});
test('an intentional source-file edit retains its old baseline and binds the produced artifact to new bytes', async () => {
  const fx = brokerFixture();
  try {
    writeFileSync(join(fx.box.cwd, 'docs/design.md'), old);
    const started = await call(fx, 'start_outcome', { ...request, intake: { ...request.intake, destination: { kind: 'project_file', ref: 'docs/design.md' } } });
    await submit(fx, await claim(fx, started.run.id), { plan: ['Revise the policy as requested'], assumptions: [], blockers: [] });
    const doing = await claim(fx, started.run.id);
    writeFileSync(join(fx.box.cwd, 'docs/design.md'), current);
    const production = await submit(fx, doing, { summary: current, findings: [current], changes: ['docs/design.md'], artifact: 'docs/design.md' });
    assert.equal(production.step.state, 'succeeded');
    const w = await claim(fx, started.run.id);
    const final = await submit(fx, w, { verification: await observedVerification(fx, w), passed: true });
    assert.equal(final.run.state, 'succeeded');
    const receipt = (getStep(fx.broker.store, w.stepRunId)!.output as any).verificationReceipt;
    assert.equal(receipt.evidence.length, 0, 'edited baseline is not silently asserted as current external support');
    assert.equal(receipt.baselines.length, 1);
    assert.notEqual(receipt.baselines[0].digest, receipt.subjects[0].digest);
    assert.equal(receipt.subjects[0].digest, contentReceipt('docs/design.md', projectResolver(fx.broker.store, fx.box.cwd)).digest);
  } finally { fx.cleanup(); }
});
test('unchanged evidence still permits the complete managed delivery', async () => {
  const fx = brokerFixture();
  try {
    const id = await produced(fx), w = await claim(fx, id);
    const final = await submit(fx, w, { verification: await observedVerification(fx, w), passed: true });
    assert.equal(final.run.state, 'succeeded');
    const receipt = (getStep(fx.broker.store, w.stepRunId)!.output as any).verificationReceipt;
    assert.equal(receipt.evidence[0].digest, contentReceipt('docs/design.md', projectResolver(fx.broker.store, fx.box.cwd)).digest);
  } finally { fx.cleanup(); }
});
