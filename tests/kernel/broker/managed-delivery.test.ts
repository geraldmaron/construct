import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { record } from '../../../src/kernel/broker/definition.ts';
import type { BrokerContext } from '../../../src/kernel/broker/context.ts';
import { createBrokerContext } from '../../../src/cli/broker-context.ts';
import { endSession, registerSession } from '../../../src/kernel/state/sessions.ts';
import { upsertDraft } from '../../../src/kernel/state/deliverables.ts';
import { getStep, listSteps } from '../../../src/kernel/state/steps.ts';
import { getWork } from '../../../src/kernel/work/service.ts';
import { listLiveLeases } from '../../../src/kernel/work/leases.ts';
import { brokerFixture, observedVerification, type BrokerFixture } from './support.ts';

async function call(ctx: BrokerContext, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const tool = TOOLS.find((t) => t.name === name)!;
  return tool.run(ctx, tool.validate(record(args)));
}
async function start(ctx: BrokerContext, words = 'Write a local design brief.') {
  return call(ctx, 'start_outcome', { workflowId: 'managed-outcome', intake: { words, kind: 'manage', deliverable: { kind: 'other', describe: 'design brief' }, destination: { kind: 'project_file', ref: 'brief.md' } } });
}
const claim = (ctx: BrokerContext, runId: string) => call(ctx, 'claim_work', { runId }).then((r) => r.work);
const submit = (ctx: BrokerContext, work: any, output: Record<string, unknown>, more = {}) => call(ctx, 'submit_work', { stepRunId: work.stepRunId, token: work.token, output, evidence: [{ ref: 'docs/design.md' }], ...more });
const plan = { plan: ['Read design and write brief'], assumptions: [], blockers: [] };
function peer(fx: BrokerFixture): BrokerContext {
  const b = fx.broker;
  return createBrokerContext(fx.ctx, { root: b.root, layout: b.layout, files: b.files, store: b.store, lane: null }, { ...fx.binding, sessionId: 'ses_next', executorId: 'session:claude-code:ses_next' });
}
const register = (fx: BrokerFixture) => registerSession(fx.broker.store, { id: fx.broker.sessionId!, host: 'claude-code', surface: 'interactive', machine: 'fixture-machine', pid: 1234, at: fx.ctx.now() });

test('a managed requested file reserves its native path once, without a new remembered commitment or wider action tier', async () => {
  const fx = brokerFixture();
  try {
    const run = await start(fx.broker);
    const held = await claim(fx.broker, run.run.id);
    assert.equal(held.step.tier, 'draft');
    assert.equal(held.delivery.path, 'brief.md');
    assert.equal(held.delivery.checkpoint.digest, null);
    assert.match(held.delivery.next, /does not widen the step tier/);
    assert.deepEqual(listLiveLeases(fx.broker.store, fx.ctx.now()).map((l) => l.path), ['brief.md']);
    const item = getWork(fx.broker.store, held.delivery.workId)!;
    assert.deepEqual(item.scope, { kind: 'managed_delivery', runId: run.run.id, path: 'brief.md' });
    assert.equal(item.status, 'claimed');
    assert.ok(!JSON.stringify(held.delivery).includes((fx.broker.store.db.prepare('SELECT claim_token FROM work_items WHERE id = ?').get(item.id) as any).claim_token), 'the broker retains its coordination secret');
    assert.ok(held.methodCatalog.every((m: any) => Object.keys(m).sort().join(',') === 'id,title'));
    await submit(fx.broker, held, plan);
    const next = await claim(fx.broker, run.run.id);
    assert.equal(next.delivery.workId, item.id);
    assert.equal((fx.broker.store.db.prepare('SELECT COUNT(*) AS n FROM work_items').get() as any).n, 1);
    assert.deepEqual(listLiveLeases(fx.broker.store, fx.ctx.now()).map((l) => l.path), ['brief.md']);
    assert.equal((fx.broker.store.db.prepare("SELECT COUNT(*) AS n FROM activity_events WHERE kind LIKE 'statement.%'").get() as any).n, 0);
  } finally { fx.cleanup(); }
});

test('a conflicting managed artifact rolls back the new work item and step lease', async () => {
  const fx = brokerFixture();
  try {
    const a = await start(fx.broker);
    await claim(fx.broker, a.run.id);
    const b = await start(peer(fx), 'Write a different design brief.');
    await assert.rejects(claim(peer(fx), b.run.id), /reserved by other work/);
    assert.equal((fx.broker.store.db.prepare('SELECT COUNT(*) AS n FROM work_items').get() as any).n, 1);
    const first = listSteps(fx.broker.store, b.run.id)[0]!;
    assert.equal(first.state, 'ready');
    assert.equal(first.attempts, 0);
  } finally { fx.cleanup(); }
});

for (const observation of ['ended', 'dead', 'alive', 'unknown', 'unregistered'] as const) {
  test(`a ${observation} holder only recovers on observed termination; finished steps and fencing survive`, async () => {
    const fx = brokerFixture();
    try {
      if (observation !== 'unregistered') register(fx);
      const run = await start(fx.broker);
      const planning = await claim(fx.broker, run.run.id);
      await submit(fx.broker, planning, plan);
      const old = await claim(fx.broker, run.run.id);
      writeFileSync(join(fx.box.cwd, 'brief.md'), 'Interrupted draft, not accepted.');
      if (observation === 'ended') endSession(fx.broker.store, { id: fx.broker.sessionId!, at: fx.ctx.now(), reason: 'test observed exit' });
      const next = { ...peer(fx), processAlive: () => observation === 'dead' ? false : observation === 'alive' ? true : null };
      const recovered = await claim(next, run.run.id);
      if (observation === 'ended' || observation === 'dead') {
        assert.equal(recovered.stepRunId, old.stepRunId);
        assert.equal(recovered.step.id, 'do');
        assert.notEqual(recovered.token, old.token);
        assert.equal(recovered.delivery.workId, old.delivery.workId);
        assert.notEqual(recovered.delivery.checkpoint.digest, null);
        assert.match(recovered.delivery.checkpoint.digest, /^[a-f0-9]{64}$/);
        assert.equal(getStep(fx.broker.store, planning.stepRunId)!.state, 'succeeded');
        assert.equal(getStep(fx.broker.store, old.stepRunId)!.attempts, 2);
        await assert.rejects(submit(fx.broker, old, {}), /not held by this session/);
        assert.equal((fx.broker.store.db.prepare("SELECT COUNT(*) AS n FROM step_attempts WHERE outcome = 'expired'").get() as any).n, 1);
      } else {
        assert.equal(recovered, null);
        assert.equal(getStep(fx.broker.store, old.stepRunId)!.attempts, 1);
        assert.equal(getWork(fx.broker.store, old.delivery.workId)!.claimOwner, 'ses_fixture/main');
      }
    } finally { fx.cleanup(); }
  });
}

test('delivery finishes atomically with verified run completion and frees the path without accepting the artifact', async () => {
  const fx = brokerFixture();
  try {
    const run = await start(fx.broker);
    await submit(fx.broker, await claim(fx.broker, run.run.id), plan);
    const doing = await claim(fx.broker, run.run.id);
    writeFileSync(join(fx.box.cwd, 'brief.md'), 'The kernel stays host-agnostic.');
    const done = await submit(fx.broker, doing, { summary: 'Kernel stays host-agnostic', findings: ['Keep the kernel host-agnostic'], changes: [], artifact: 'brief.md' });
    assert.equal(done.step.state, 'succeeded', JSON.stringify(done.validation));
    const verify = await claim(fx.broker, run.run.id);
    const output = { verification: await observedVerification(fx, verify), passed: true };
    fx.broker.store.db.exec("CREATE TEMP TRIGGER reject_delivery BEFORE UPDATE OF status ON work_items WHEN NEW.status = 'completed' BEGIN SELECT RAISE(ABORT, 'test settlement failure'); END;");
    await assert.rejects(submit(fx.broker, verify, output), /test settlement failure/);
    assert.equal(getStep(fx.broker.store, verify.stepRunId)!.state, 'leased', 'failed ledger settlement rolls back workflow success');
    fx.broker.store.db.exec('DROP TRIGGER reject_delivery');
    const final = await submit(fx.broker, verify, output);
    assert.equal(final.run.state, 'succeeded', JSON.stringify(final.validation));
    assert.equal(getWork(fx.broker.store, verify.delivery.workId)!.status, 'completed');
    assert.equal(listLiveLeases(fx.broker.store, fx.ctx.now()).length, 0);
    assert.ok(!['accepted', 'final'].includes(final.deliverable.trust));
  } finally { fx.cleanup(); }
});

test('a failed required verification frees the path and never marks delivery complete', async () => {
  const fx = brokerFixture();
  try {
    const run = await start(fx.broker);
    await submit(fx.broker, await claim(fx.broker, run.run.id), plan);
    const doing = await claim(fx.broker, run.run.id);
    writeFileSync(join(fx.box.cwd, 'brief.md'), 'The kernel stays host-agnostic.');
    await submit(fx.broker, doing, { summary: 'Kernel stays host-agnostic', findings: ['Keep the kernel host-agnostic'], changes: [], artifact: 'brief.md' });
    const verify = await claim(fx.broker, run.run.id);
    const final = await submit(fx.broker, verify, { verification: { result: 'The model claims success.' }, passed: true });
    assert.notEqual(final.run.state, 'succeeded');
    assert.ok(final.validation.some((v: any) => v.validator === 'execution_required' && !v.ok));
    assert.notEqual(getWork(fx.broker.store, verify.delivery.workId)!.status, 'completed');
    assert.equal(listLiveLeases(fx.broker.store, fx.ctx.now()).length, 0);
  } finally { fx.cleanup(); }
});


test('a replacement session receives held draft bytes at the writable step without treating them as accepted', async () => {
  const fx = brokerFixture();
  try {
    register(fx);
    const run = await start(fx.broker);
    const planning = await claim(fx.broker, run.run.id);
    await submit(fx.broker, planning, plan);
    upsertDraft(fx.broker.store, { id: 'held-draft', runId: run.run.id, kind: 'outcome/managed', body: { summary: 'The evidence remains uncertain.', unresolved: ['Current units are unknown.'] }, at: fx.ctx.now() });
    const old = await claim(fx.broker, run.run.id);
    endSession(fx.broker.store, { id: fx.broker.sessionId!, at: fx.ctx.now(), reason: 'observed exit' });
    const next = await claim(peer(fx), run.run.id);
    assert.equal(next.stepRunId, old.stepRunId);
    assert.deepEqual(next.delivery.prepared.body, { summary: 'The evidence remains uncertain.', unresolved: ['Current units are unknown.'] });
    assert.equal(next.delivery.prepared.ref, 'deliverable:held-draft');
    assert.equal(next.delivery.checkpoint.digest, null, 'a held draft is not a file');
    assert.equal(next.delivery.prepared.omitted, false);
  } finally { fx.cleanup(); }
});

test('the explicitly bound headless adapter receives the same file reservation without inventing an executor', async () => {
  const fx = brokerFixture();
  try {
    const run = await start(fx.broker);
    const b = fx.broker;
    const project = { root: b.root, layout: b.layout, files: b.files, store: b.store, lane: null };
    const unprovisioned = createBrokerContext(fx.ctx, project, { ...fx.binding, surface: 'headless', executorId: 'runner:absent', sessionId: 'ses_none' });
    const refused = await call(unprovisioned, 'claim_step', { runId: run.run.id });
    assert.equal(refused.work, null);
    assert.equal(listLiveLeases(b.store, fx.ctx.now()).length, 0);
    const bound = createBrokerContext(fx.ctx, project, { ...fx.binding, surface: 'headless', executorId: 'runner:codex:fixture', sessionId: 'ses_bound' });
    const result = await call(bound, 'claim_step', { runId: run.run.id });
    assert.equal(result.work.delivery.path, 'brief.md');
    assert.equal(result.work.delivery.owner, 'ses_bound/main');
    assert.deepEqual(listLiveLeases(b.store, fx.ctx.now()).map((l) => l.path), ['brief.md']);
  } finally { fx.cleanup(); }
});
