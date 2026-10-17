import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { record } from '../../../src/kernel/broker/definition.ts';
import type { BrokerContext } from '../../../src/kernel/broker/context.ts';
import { createBrokerContext } from '../../../src/cli/broker-context.ts';
import { endSession, registerSession } from '../../../src/kernel/state/sessions.ts';
import { appendActivity } from '../../../src/kernel/state/activity.ts';
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
  return call(ctx, 'start_outcome', {
    workflowId: 'managed-outcome',
    intake: {
      words,
      kind: 'manage',
      stakes: { reversible: true, affects: [] },
      deliverable: { kind: 'other', describe: 'design brief' },
      destination: { kind: 'project_file', ref: 'brief.md' },
    },
  });
}
const claim = (ctx: BrokerContext, runId: string) => call(ctx, 'claim_work', { runId }).then((r) => r.work);
const submit = (ctx: BrokerContext, work: any, output: Record<string, unknown>, more = {}) =>
  call(ctx, 'submit_work', { stepRunId: work.stepRunId, token: work.token, output, evidence: [{ ref: 'docs/design.md' }], ...more });
const plan = { plan: ['Read design and write brief'], assumptions: [], blockers: [] };
function peer(fx: BrokerFixture): BrokerContext {
  const b = fx.broker;
  return createBrokerContext(
    fx.ctx,
    { root: b.root, layout: b.layout, files: b.files, store: b.store, lane: null },
    { ...fx.binding, sessionId: 'ses_next', executorId: 'session:claude-code:ses_next' },
  );
}
const register = (fx: BrokerFixture) =>
  registerSession(fx.broker.store, {
    id: fx.broker.sessionId!,
    host: 'claude-code',
    surface: 'interactive',
    machine: 'fixture-machine',
    pid: 1234,
    at: fx.ctx.now(),
  });

test('a managed requested file reserves its native path once, without a new remembered commitment or wider action tier', async () => {
  const fx = brokerFixture();
  try {
    const run = await start(fx.broker);
    const held = await claim(fx.broker, run.run.id);
    assert.equal(held.step.tier, 'draft');
    assert.equal(held.delivery.path, 'brief.md');
    assert.equal(held.delivery.checkpoint.digest, null);
    assert.match(held.delivery.next, /does not widen the step tier/);
    assert.deepEqual(
      listLiveLeases(fx.broker.store, fx.ctx.now()).map((l) => l.path),
      ['brief.md'],
    );
    const item = getWork(fx.broker.store, held.delivery.workId)!;
    assert.deepEqual(item.scope, { kind: 'managed_delivery', runId: run.run.id, path: 'brief.md' });
    assert.equal(item.status, 'claimed');
    assert.ok(
      !JSON.stringify(held.delivery).includes(
        (fx.broker.store.db.prepare('SELECT claim_token FROM work_items WHERE id = ?').get(item.id) as any).claim_token,
      ),
      'the broker retains its coordination secret',
    );
    assert.ok(held.methodCatalog.every((m: any) => Object.keys(m).sort().join(',') === 'id,title'));
    await submit(fx.broker, held, plan);
    const next = await claim(fx.broker, run.run.id);
    assert.equal(next.delivery.workId, item.id);
    assert.equal((fx.broker.store.db.prepare('SELECT COUNT(*) AS n FROM work_items').get() as any).n, 1);
    assert.deepEqual(
      listLiveLeases(fx.broker.store, fx.ctx.now()).map((l) => l.path),
      ['brief.md'],
    );
    assert.equal((fx.broker.store.db.prepare("SELECT COUNT(*) AS n FROM activity_events WHERE kind LIKE 'statement.%'").get() as any).n, 0);
  } finally {
    fx.cleanup();
  }
});

test('a conflicting managed artifact rolls back the new work item and step lease', async () => {
  const fx = brokerFixture();
  try {
    const a = await start(fx.broker);
    await claim(fx.broker, a.run.id);
    const b = await start(peer(fx), 'Write a different design brief.');
    const conflict = await call(peer(fx), 'claim_work', { runId: b.run.id });
    assert.equal(conflict.work, null);
    assert.equal(conflict.waitingOn.kind, 'delivery_recovery');
    assert.equal(conflict.waitingOn.priorRunId, a.run.id);
    assert.equal((fx.broker.store.db.prepare('SELECT COUNT(*) AS n FROM work_items').get() as any).n, 1);
    const first = listSteps(fx.broker.store, b.run.id)[0]!;
    assert.equal(first.state, 'ready');
    assert.equal(first.attempts, 0);
  } finally {
    fx.cleanup();
  }
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
      if (observation === 'ended')
        endSession(fx.broker.store, { id: fx.broker.sessionId!, at: fx.ctx.now(), reason: 'test observed exit' });
      const next = { ...peer(fx), processAlive: () => (observation === 'dead' ? false : observation === 'alive' ? true : null) };
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
    } finally {
      fx.cleanup();
    }
  });
}

test('delivery finishes atomically with verified run completion and frees the path without accepting the artifact', async () => {
  const fx = brokerFixture();
  try {
    const run = await start(fx.broker);
    await submit(fx.broker, await claim(fx.broker, run.run.id), plan);
    const doing = await claim(fx.broker, run.run.id);
    writeFileSync(join(fx.box.cwd, 'brief.md'), 'The kernel stays host-agnostic.');
    const done = await submit(fx.broker, doing, {
      summary: 'Kernel stays host-agnostic',
      findings: ['Keep the kernel host-agnostic'],
      changes: [],
      artifact: 'brief.md',
    });
    assert.equal(done.step.state, 'succeeded', JSON.stringify(done.validation));
    const verify = await claim(fx.broker, run.run.id);
    const output = { verification: await observedVerification(fx, verify), passed: true };
    fx.broker.store.db.exec(
      "CREATE TEMP TRIGGER reject_delivery BEFORE UPDATE OF status ON work_items WHEN NEW.status = 'completed' BEGIN SELECT RAISE(ABORT, 'test settlement failure'); END;",
    );
    await assert.rejects(submit(fx.broker, verify, output), /test settlement failure/);
    assert.equal(getStep(fx.broker.store, verify.stepRunId)!.state, 'leased', 'failed ledger settlement rolls back workflow success');
    fx.broker.store.db.exec('DROP TRIGGER reject_delivery');
    const final = await submit(fx.broker, verify, output);
    assert.equal(final.run.state, 'succeeded', JSON.stringify(final.validation));
    assert.equal(getWork(fx.broker.store, verify.delivery.workId)!.status, 'completed');
    assert.equal(listLiveLeases(fx.broker.store, fx.ctx.now()).length, 0);
    assert.ok(!['accepted', 'final'].includes(final.deliverable.trust));
  } finally {
    fx.cleanup();
  }
});

test('a failed required verification frees the path and never marks delivery complete', async () => {
  const fx = brokerFixture();
  try {
    const run = await start(fx.broker);
    await submit(fx.broker, await claim(fx.broker, run.run.id), plan);
    const doing = await claim(fx.broker, run.run.id);
    writeFileSync(join(fx.box.cwd, 'brief.md'), 'The kernel stays host-agnostic.');
    await submit(fx.broker, doing, {
      summary: 'Kernel stays host-agnostic',
      findings: ['Keep the kernel host-agnostic'],
      changes: [],
      artifact: 'brief.md',
    });
    const verify = await claim(fx.broker, run.run.id);
    const final = await submit(fx.broker, verify, { verification: { result: 'The model claims success.' }, passed: true });
    assert.notEqual(final.run.state, 'succeeded');
    assert.ok(final.validation.some((v: any) => v.validator === 'execution_required' && !v.ok));
    assert.notEqual(getWork(fx.broker.store, verify.delivery.workId)!.status, 'completed');
    assert.equal(listLiveLeases(fx.broker.store, fx.ctx.now()).length, 0);
  } finally {
    fx.cleanup();
  }
});

test('a replacement session receives held draft bytes at the writable step without treating them as accepted', async () => {
  const fx = brokerFixture();
  try {
    register(fx);
    const run = await start(fx.broker);
    const planning = await claim(fx.broker, run.run.id);
    await submit(fx.broker, planning, plan);
    upsertDraft(fx.broker.store, {
      id: 'held-draft',
      runId: run.run.id,
      kind: 'outcome/managed',
      body: { summary: 'The evidence remains uncertain.', unresolved: ['Current units are unknown.'] },
      at: fx.ctx.now(),
    });
    const old = await claim(fx.broker, run.run.id);
    endSession(fx.broker.store, { id: fx.broker.sessionId!, at: fx.ctx.now(), reason: 'observed exit' });
    const next = await claim(peer(fx), run.run.id);
    assert.equal(next.stepRunId, old.stepRunId);
    assert.deepEqual(next.delivery.prepared.body, {
      summary: 'The evidence remains uncertain.',
      unresolved: ['Current units are unknown.'],
    });
    assert.equal(next.delivery.prepared.ref, 'deliverable:held-draft');
    assert.equal(next.delivery.checkpoint.digest, null, 'a held draft is not a file');
    assert.equal(next.delivery.prepared.omitted, false);
  } finally {
    fx.cleanup();
  }
});

test('the explicitly bound headless adapter receives the same file reservation without inventing an executor', async () => {
  const fx = brokerFixture();
  try {
    const run = await start(fx.broker);
    const b = fx.broker;
    const project = { root: b.root, layout: b.layout, files: b.files, store: b.store, lane: null };
    const unprovisioned = createBrokerContext(fx.ctx, project, {
      ...fx.binding,
      surface: 'headless',
      executorId: 'runner:absent',
      sessionId: 'ses_none',
    });
    const refused = await call(unprovisioned, 'claim_step', { runId: run.run.id });
    assert.equal(refused.work, null);
    assert.equal(listLiveLeases(b.store, fx.ctx.now()).length, 0);
    const bound = createBrokerContext(fx.ctx, project, {
      ...fx.binding,
      surface: 'headless',
      executorId: 'runner:codex:fixture',
      sessionId: 'ses_bound',
    });
    const result = await call(bound, 'claim_step', { runId: run.run.id });
    assert.equal(result.work.delivery.path, 'brief.md');
    assert.equal(result.work.delivery.owner, 'ses_bound/main');
    assert.deepEqual(
      listLiveLeases(b.store, fx.ctx.now()).map((l) => l.path),
      ['brief.md'],
    );
  } finally {
    fx.cleanup();
  }
});

for (const observation of ['ended', 'dead'] as const) {
  test(`a newer request replaces ${observation} preparation atomically without replaying it`, async () => {
    const fx = brokerFixture();
    try {
      register(fx);
      const oldRun = await start(fx.broker),
        old = await claim(fx.broker, oldRun.run.id);
      if (observation === 'ended') endSession(fx.broker.store, { id: fx.broker.sessionId!, at: fx.ctx.now(), reason: 'observed exit' });
      const next = { ...peer(fx), processAlive: () => (observation === 'dead' ? false : null) };
      const requested = await start(next, 'Recheck the current evidence and write the corrected brief.');
      const work = await claim(next, requested.run.id);
      assert.equal(work.run.id, requested.run.id);
      assert.equal(work.step.id, 'plan');
      assert.deepEqual(work.delivery.recoveredPreparation, [
        { runId: oldRun.run.id, workId: old.delivery.workId, evidence: observation === 'dead' ? 'absent' : 'ended' },
      ]);
      assert.equal((await call(next, 'run_status', { runId: oldRun.run.id })).run.state, 'cancelled');
      assert.equal(getWork(fx.broker.store, old.delivery.workId)!.status, 'cancelled');
      assert.equal(listLiveLeases(fx.broker.store, fx.ctx.now()).length, 1);
      assert.equal(listLiveLeases(fx.broker.store, fx.ctx.now())[0]!.workId, work.delivery.workId);
      await assert.rejects(submit(fx.broker, old, plan), /not held by this session/);
      assert.equal(
        (fx.broker.store.db.prepare("SELECT count(*) n FROM activity_events WHERE kind = 'delivery.preparation_superseded'").get() as any)
          .n,
        1,
      );
    } finally {
      fx.cleanup();
    }
  });
}

for (const state of ['live', 'unknown', 'quiet', 'unregistered'] as const) {
  test(`a new request preserves a ${state} reservation holder and returns recovery without a new lease`, async () => {
    const fx = brokerFixture();
    try {
      if (state !== 'unregistered') register(fx);
      const oldRun = await start(fx.broker),
        old = await claim(fx.broker, oldRun.run.id);
      if (state === 'quiet')
        fx.broker.store.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run('2020-01-01T00:00:00Z', fx.broker.sessionId);
      const next = { ...peer(fx), processAlive: () => (state === 'live' ? true : null) };
      const run = await start(next, 'Recheck current evidence for the brief.');
      const result = await call(next, 'claim_work', { runId: run.run.id });
      assert.equal(result.work, null);
      assert.equal(result.waitingOn.kind, 'delivery_recovery');
      assert.equal(result.waitingOn.priorRunId, oldRun.run.id);
      assert.equal(result.waitingOn.holder, state === 'live' ? 'live' : 'unknown');
      assert.equal(getWork(fx.broker.store, old.delivery.workId)!.claimOwner, 'ses_fixture/main');
      assert.equal(listSteps(fx.broker.store, run.run.id)[0]!.attempts, 0);
      assert.equal(getStep(fx.broker.store, old.stepRunId)!.state, 'leased');
    } finally {
      fx.cleanup();
    }
  });
}

test('a dead reservation creator does not allow cancelling a step now held by a live peer', async () => {
  const fx = brokerFixture();
  try {
    register(fx);
    const prior = await start(fx.broker),
      old = await claim(fx.broker, prior.run.id);
    endSession(fx.broker.store, { id: fx.broker.sessionId!, at: fx.ctx.now(), reason: 'observed exit' });
    registerSession(fx.broker.store, {
      id: 'ses_other',
      host: 'claude-code',
      surface: 'interactive',
      machine: 'fixture-machine',
      pid: 5678,
      at: fx.ctx.now(),
    });
    fx.broker.store.db.prepare('UPDATE step_runs SET lease_owner = ? WHERE id = ?').run('session:claude-code:ses_other', old.stepRunId);
    const next = { ...peer(fx), processAlive: () => true },
      run = await start(next, 'Write the revised brief.');
    const result = await call(next, 'claim_work', { runId: run.run.id });
    assert.match(result.waitingOn.reasons.join(' '), /outstanding step/);
    assert.equal(getStep(fx.broker.store, old.stepRunId)!.leaseOwner, 'session:claude-code:ses_other');
    assert.equal((await call(next, 'run_status', { runId: prior.run.id })).run.state, 'running');
  } finally {
    fx.cleanup();
  }
});

for (const blocker of ['writable-history', 'handoff', 'artifact', 'execution', 'directory', 'changed-definition'] as const) {
  test(`terminated preparation with ${blocker} remains protected for explicit reconciliation`, async () => {
    const fx = brokerFixture();
    try {
      register(fx);
      const prior = await start(fx.broker),
        old = await claim(fx.broker, prior.run.id);
      if (blocker === 'writable-history') {
        await submit(fx.broker, old, plan);
        const doing = await claim(fx.broker, prior.run.id);
        fx.broker.store.db
          .prepare("UPDATE step_runs SET state = 'ready', lease_owner = NULL, lease_until = NULL WHERE id = ?")
          .run(doing.stepRunId);
      }
      if (blocker === 'artifact') writeFileSync(join(fx.box.cwd, 'brief.md'), 'Unreported draft that must survive.');
      if (blocker === 'handoff')
        fx.broker.store.db
          .prepare('UPDATE work_items SET handoff_json = ? WHERE id = ?')
          .run(JSON.stringify({ to: 'ses_designated', takenAt: null }), old.delivery.workId);
      if (blocker === 'execution')
        appendActivity(fx.broker.store, {
          at: fx.ctx.now(),
          kind: 'verification.executed',
          runId: prior.run.id,
          channel: 'host_command',
          payload: { synthetic: true },
        });
      if (blocker === 'directory')
        fx.broker.store.db.prepare("UPDATE path_leases SET path = '/' WHERE work_id = ?").run(old.delivery.workId);
      if (blocker === 'changed-definition')
        fx.broker.store.db.prepare("UPDATE workflow_runs SET workflow_digest = 'different' WHERE id = ?").run(prior.run.id);
      endSession(fx.broker.store, { id: fx.broker.sessionId!, at: fx.ctx.now(), reason: 'observed exit' });
      const next = peer(fx),
        run = await start(next, 'Recheck and update the brief.');
      const result = await call(next, 'claim_work', { runId: run.run.id });
      assert.equal(result.work, null);
      assert.equal(result.waitingOn.kind, 'delivery_recovery');
      assert.ok(result.waitingOn.reasons.length);
      assert.equal(getWork(fx.broker.store, old.delivery.workId)!.claimOwner, 'ses_fixture/main');
      assert.equal(listSteps(fx.broker.store, run.run.id)[0]!.attempts, 0);
      if (blocker === 'artifact') assert.equal(readFileSync(join(fx.box.cwd, 'brief.md'), 'utf8'), 'Unreported draft that must survive.');
    } finally {
      fx.cleanup();
    }
  });
}

test('claiming an older request never supersedes a newer dead holder', async () => {
  const fx = brokerFixture();
  try {
    register(fx);
    const next = peer(fx),
      older = await start(next, 'The older brief request.');
    const newer = await start(fx.broker, 'The newer brief request.'),
      held = await claim(fx.broker, newer.run.id);
    endSession(fx.broker.store, { id: fx.broker.sessionId!, at: fx.ctx.now(), reason: 'observed exit' });
    const result = await call(next, 'claim_work', { runId: older.run.id });
    assert.match(result.waitingOn.reasons.join(' '), /not a newer run/);
    assert.equal(getStep(fx.broker.store, held.stepRunId)!.state, 'leased');
  } finally {
    fx.cleanup();
  }
});

test('a failed new reservation rolls back old cancellation, ownership, leases and supersession evidence', async () => {
  const fx = brokerFixture();
  try {
    register(fx);
    const prior = await start(fx.broker),
      old = await claim(fx.broker, prior.run.id);
    endSession(fx.broker.store, { id: fx.broker.sessionId!, at: fx.ctx.now(), reason: 'observed exit' });
    const next = peer(fx),
      requested = await start(next, 'Recheck the brief.');
    fx.broker.store.db.exec(
      `CREATE TEMP TRIGGER refuse_new_reservation BEFORE INSERT ON path_leases WHEN NEW.work_id != '${old.delivery.workId}' BEGIN SELECT RAISE(ABORT, 'synthetic second reservation failure'); END;`,
    );
    await assert.rejects(claim(next, requested.run.id), /synthetic second reservation failure/);
    assert.equal(getStep(fx.broker.store, old.stepRunId)!.state, 'leased');
    assert.equal(getWork(fx.broker.store, old.delivery.workId)!.claimOwner, 'ses_fixture/main');
    assert.equal(listSteps(fx.broker.store, requested.run.id)[0]!.attempts, 0);
    assert.equal(
      (fx.broker.store.db.prepare("SELECT count(*) n FROM activity_events WHERE kind = 'delivery.preparation_superseded'").get() as any).n,
      0,
    );
    assert.equal((await call(next, 'run_status', { runId: prior.run.id })).run.state, 'running');
  } finally {
    fx.cleanup();
  }
});

test('competing newer requests leave only one new writer and preserve the winner', async () => {
  const fx = brokerFixture();
  try {
    register(fx);
    const prior = await start(fx.broker);
    await claim(fx.broker, prior.run.id);
    endSession(fx.broker.store, { id: fx.broker.sessionId!, at: fx.ctx.now(), reason: 'observed exit' });
    const next = peer(fx),
      a = await start(next, 'First correction.'),
      b = await start(next, 'Second correction.');
    const [one, two] = await Promise.all([call(next, 'claim_work', { runId: a.run.id }), call(next, 'claim_work', { runId: b.run.id })]);
    assert.ok(one.work);
    assert.equal(two.work, null);
    assert.equal(two.waitingOn.kind, 'delivery_recovery');
    assert.equal(listLiveLeases(fx.broker.store, fx.ctx.now()).length, 1);
    assert.equal(getStep(fx.broker.store, one.work.stepRunId)!.state, 'leased');
  } finally {
    fx.cleanup();
  }
});

test('preparation packets scope the method to current outputs and leave final review to its step', async () => {
  const fx = brokerFixture('interactive', { semanticReview: 'none' });
  try {
    const run = await call(fx.broker, 'start_outcome', {
      workflowId: 'research-brief',
      input: { question: 'What does the supplied evidence establish?' },
    });
    const work = await claim(fx.broker, run.run.id);
    assert.equal(work.step.id, 'gather');
    assert.equal(work.step.tier, 'observe');
    assert.ok(work.instructions.some((s: string) => s.includes('submit_work with its declared outputs')));
    assert.ok(work.instructions.some((s: string) => s.includes('explicit unknown/access boundaries')));
    assert.ok(work.instructions.some((s: string) => s.includes('later challenge step')));
    assert.ok(!work.instructions.some((s: string) => s.startsWith('Managed completion requires')));
    assert.equal(work.semanticReview.state, 'not_required');
    assert.ok(work.step.validators.includes('reference_coverage'), 'phase guidance does not waive coverage');
  } finally {
    fx.cleanup();
  }
});

for (const holder of ['ended', 'live', 'unknown'] as const) {
  test(`an already-expired preparation lease with a live reservation respects its ${holder} holder`, async () => {
    const fx = brokerFixture();
    try {
      register(fx);
      const prior = await start(fx.broker),
        old = await claim(fx.broker, prior.run.id);
      fx.broker.store.db.prepare('UPDATE step_runs SET lease_until = ? WHERE id = ?').run('2020-01-01T00:00:00Z', old.stepRunId);
      if (holder === 'ended') endSession(fx.broker.store, { id: fx.broker.sessionId!, at: fx.ctx.now(), reason: 'observed exit' });
      const next = { ...peer(fx), processAlive: () => (holder === 'live' ? true : null) };
      const run = await start(next, 'Recheck the brief after an interrupted preparation.');
      const result = await call(next, 'claim_work', { runId: run.run.id });
      if (holder === 'ended') {
        assert.equal(result.work.run.id, run.run.id);
        assert.equal(getStep(fx.broker.store, old.stepRunId)!.state, 'cancelled');
        assert.equal(getWork(fx.broker.store, old.delivery.workId)!.status, 'cancelled');
      } else {
        assert.equal(result.work, null);
        assert.equal(result.waitingOn.kind, 'delivery_recovery');
        assert.equal(getStep(fx.broker.store, old.stepRunId)!.state, 'leased');
        assert.equal(getWork(fx.broker.store, old.delivery.workId)!.status, 'claimed');
      }
    } finally {
      fx.cleanup();
    }
  });
}

for (const path of [
  'briefs/Release Notes.md',
  'Release Notes.md',
  'Team Briefs/Release Notes.md',
  'briefs/Release#v2 Notes.md',
  'briefs/Release Notes.md:12',
])
  test(`managed delivery supports the ordinary filename ${path}`, async () => {
    const { mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    const fx = brokerFixture();
    try {
      const started = await call(fx.broker, 'start_outcome', {
        workflowId: 'managed-outcome',
        intake: {
          kind: 'manage',
          stakes: { reversible: true, affects: [] },
          words: 'Write the requested design brief.',
          deliverable: { kind: 'other', describe: 'brief' },
          destination: { kind: 'project_file', ref: path },
        },
      });
      const planning = await claim(fx.broker, started.run.id);
      assert.equal(planning.delivery.path, path);
      assert.ok(planning.delivery.reservedPath);
      await submit(fx.broker, planning, plan);
      const writing = await claim(fx.broker, started.run.id);
      mkdirSync(dirname(join(fx.box.cwd, path)), { recursive: true });
      writeFileSync(join(fx.box.cwd, path), 'Keep the kernel host-agnostic.');
      const done = await submit(fx.broker, writing, {
        summary: 'Saved the design brief.',
        findings: ['Keep the kernel host-agnostic.'],
        changes: [path],
        artifact: path,
      });
      assert.equal(done.step.state, 'succeeded', JSON.stringify(done.validation));
      const verifying = await claim(fx.broker, started.run.id);
      const result = await submit(fx.broker, verifying, { verification: await observedVerification(fx, verifying), passed: true });
      assert.equal(result.run.state, 'succeeded', JSON.stringify(result.validation));
      assert.equal(readFileSync(join(fx.box.cwd, path), 'utf8'), 'Keep the kernel host-agnostic.');
    } finally {
      fx.cleanup();
    }
  });

for (const path of ['briefs/Release#v2 Notes.md', 'briefs/Release Notes.md:12'])
  test(`a citation-shaped decoy never substitutes for literal artifact ${path}`, async () => {
    const { mkdirSync, existsSync } = await import('node:fs');
    const fx = brokerFixture();
    try {
      mkdirSync(join(fx.box.cwd, 'briefs'));
      const decoy = path.split('#')[0]!.replace(/:\d+$/, '');
      writeFileSync(join(fx.box.cwd, decoy), 'Unrelated existing document.');
      const started = await call(fx.broker, 'start_outcome', {
        workflowId: 'managed-outcome',
        intake: {
          kind: 'manage',
          stakes: { reversible: true, affects: [] },
          words: 'Write the literal requested file.',
          deliverable: { kind: 'other', describe: 'brief' },
          destination: { kind: 'project_file', ref: path },
        },
      });
      const planning = await claim(fx.broker, started.run.id);
      assert.equal(planning.delivery.checkpoint.digest, null, 'missing literal file has no receipt');
      await submit(fx.broker, planning, plan);
      const writing = await claim(fx.broker, started.run.id);
      const result = await submit(fx.broker, writing, {
        summary: 'Wrote the requested file.',
        findings: ['Unrelated existing document.'],
        changes: [path],
        artifact: path,
      });
      assert.notEqual(result.step.state, 'succeeded');
      assert.ok(result.validation.some((v: any) => v.validator === 'artifacts_exist' && !v.ok));
      assert.equal(existsSync(join(fx.box.cwd, path)), false);
    } finally {
      fx.cleanup();
    }
  });

test('managed destinations refuse symlink aliases before reserving any work', async () => {
  const { symlinkSync } = await import('node:fs');
  const fx = brokerFixture();
  try {
    symlinkSync(join(fx.box.cwd, 'docs'), join(fx.box.cwd, 'alias'), 'dir');
    symlinkSync(fx.box.home, join(fx.box.cwd, 'outside'), 'dir');
    for (const ref of ['alias/design.md', 'alias/new/Brief Notes.md', 'outside/Brief Notes.md']) {
      await assert.rejects(
        call(fx.broker, 'start_outcome', {
          workflowId: 'managed-outcome',
          intake: {
            kind: 'manage',
            stakes: { reversible: true, affects: [] },
            words: `Write ${ref}.`,
            deliverable: { kind: 'other', describe: 'brief' },
            destination: { kind: 'project_file', ref },
          },
        }),
        /symlink|symbolic link|canonical/i,
      );
      assert.equal(listLiveLeases(fx.broker.store, fx.ctx.now()).length, 0);
    }
  } finally {
    fx.cleanup();
  }
});

test('spaced-filename directory reservation is explicit and preserves collision and confinement rules', async () => {
  const fx = brokerFixture();
  try {
    const started = await call(fx.broker, 'start_outcome', {
      workflowId: 'managed-outcome',
      intake: {
        kind: 'manage',
        stakes: { reversible: true, affects: [] },
        words: 'Write a release brief.',
        deliverable: { kind: 'other', describe: 'brief' },
        destination: { kind: 'project_file', ref: 'briefs/Release Notes.md' },
      },
    });
    const held = await claim(fx.broker, started.run.id);
    assert.equal(held.delivery.reservedPath, 'briefs/');
    assert.match(held.delivery.next, /reserved conservatively/);
    assert.deepEqual(
      listLiveLeases(fx.broker.store, fx.ctx.now()).map((lease) => lease.path),
      ['briefs/'],
    );
    const reason = await call(fx.broker, 'remember', { kind: 'outcome', text: 'Unrelated edits remain coordinated' });
    const sibling = await call(fx.broker, 'work', { action: 'add', title: 'Other brief', serves: reason.remembered.id });
    await assert.rejects(
      call(fx.broker, 'work', { action: 'claim', id: sibling.id, paths: ['briefs/Other.md'] }),
      /reserved by other work/,
    );
    await call(fx.broker, 'work', { action: 'claim', id: sibling.id, paths: ['other/Notes.md'] });
    await assert.rejects(
      call(fx.broker, 'start_outcome', {
        workflowId: 'managed-outcome',
        intake: {
          kind: 'manage',
          stakes: { reversible: true, affects: [] },
          words: 'Write elsewhere.',
          deliverable: { kind: 'other', describe: 'brief' },
          destination: { kind: 'project_file', ref: '../Outside Notes.md' },
        },
      }),
      /inside|relative|project/,
    );
  } finally {
    fx.cleanup();
  }
});

test('conservative scope never recovers a different artifact from an ended holder', async () => {
  const fx = brokerFixture();
  try {
    register(fx);
    const request = (ctx: BrokerContext, ref: string, words: string) =>
      call(ctx, 'start_outcome', {
        workflowId: 'managed-outcome',
        intake: {
          kind: 'manage',
          stakes: { reversible: true, affects: [] },
          words,
          deliverable: { kind: 'other', describe: 'brief' },
          destination: { kind: 'project_file', ref },
        },
      });
    const prior = await request(fx.broker, 'briefs/Release Notes.md', 'Write the release brief.');
    const held = await claim(fx.broker, prior.run.id);
    endSession(fx.broker.store, { id: fx.broker.sessionId!, at: fx.ctx.now(), reason: 'observed exit' });
    const next = { ...peer(fx), processAlive: () => null };
    const different = await request(next, 'briefs/Other Notes.md', 'Write the other brief.');
    const blocked = await call(next, 'claim_work', { runId: different.run.id });
    assert.equal(blocked.work, null);
    assert.equal(blocked.waitingOn.kind, 'delivery_recovery');
    assert.equal(getWork(fx.broker.store, held.delivery.workId)!.status, 'claimed');
    assert.equal(listLiveLeases(fx.broker.store, fx.ctx.now()).length, 1);
    const same = await request(next, 'briefs/Release Notes.md', 'Recheck evidence and write the corrected release brief.');
    const recovered = await claim(next, same.run.id);
    assert.equal(recovered.delivery.recoveredPreparation[0].workId, held.delivery.workId);
    assert.equal(listLiveLeases(fx.broker.store, fx.ctx.now()).length, 1);
  } finally {
    fx.cleanup();
  }
});

for (const kind of ['symbolic', 'hard'] as const)
  test(`a broad managed scope containing ${kind} links refuses the first grant atomically`, async () => {
    const { mkdirSync, symlinkSync, linkSync } = await import('node:fs');
    const fx = brokerFixture();
    try {
      mkdirSync(join(fx.box.cwd, 'briefs'));
      if (kind === 'symbolic') symlinkSync(join(fx.box.cwd, 'docs'), join(fx.box.cwd, 'briefs/alias'), 'dir');
      else linkSync(join(fx.box.cwd, 'docs/design.md'), join(fx.box.cwd, 'briefs/copy.md'));
      const started = await call(fx.broker, 'start_outcome', {
        workflowId: 'managed-outcome',
        intake: {
          kind: 'manage',
          stakes: { reversible: true, affects: [] },
          words: 'Write a local release note.',
          deliverable: { kind: 'other', describe: 'brief' },
          destination: { kind: 'project_file', ref: 'briefs/Release Notes.md' },
        },
      });
      await assert.rejects(call(fx.broker, 'claim_work', { runId: started.run.id }), /directory.*contains symbolic or hard links/i);
      assert.equal(listLiveLeases(fx.broker.store, fx.ctx.now()).length, 0);
      assert.equal(getWork(fx.broker.store, `work-${started.run.id}-delivery`), null);
      assert.ok(listSteps(fx.broker.store, started.run.id).every((step) => step.state !== 'leased'));
    } finally {
      fx.cleanup();
    }
  });

test('a run that is cancelled ends its delivery reservation, whoever cancels it, and a host can never claim the reservation', async () => {
  const fx = brokerFixture();
  try {
    const run = await start(fx.broker);
    const held = await claim(fx.broker, run.run.id);
    const id = held.delivery.workId;
    assert.equal(getWork(fx.broker.store, id)!.status, 'claimed');
    // The generic work tool cannot take, hand off or settle a run's reservation.
    for (const action of ['claim', 'release', 'complete'] as const) {
      await assert.rejects(call(fx.broker, 'work', { action, id, token: 'x', reason: 'r' }), /claim_work with that runId/, action);
    }
    assert.ok(!(await call(fx.broker, 'work', { action: 'ready' })).some((w: { id: string }) => w.id === id), 'never listed as ready');
    // Another session cancels the run directly through the service, as `construct run cancel` does; the step in progress finishes first.
    peer(fx).workflow.cancel({ runId: run.run.id, by: 'person', reason: 'no longer needed' });
    assert.equal(getWork(fx.broker.store, id)!.status, 'claimed', 'held while the step in progress finishes');
    await submit(fx.broker, held, plan);
    const ended = getWork(fx.broker.store, id)!;
    assert.equal(ended.status, 'cancelled', 'the reservation ends with its run');
    assert.match(ended.reason ?? '', /was cancelled, so it can never deliver/);
    assert.deepEqual(listLiveLeases(fx.broker.store, fx.ctx.now()), [], 'its path is free');
  } finally {
    fx.cleanup();
  }
});
