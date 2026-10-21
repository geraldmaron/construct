import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { record } from '../../../src/kernel/broker/definition.ts';
import { getStep, listSteps } from '../../../src/kernel/state/steps.ts';
import { getRun } from '../../../src/kernel/state/runs.ts';
import { getDeliverable } from '../../../src/kernel/state/deliverables.ts';
import { skillQuality } from '../../../src/kernel/state/quality.ts';
import { brokerFixture } from './support.ts';
import { run } from '../../../src/cli/index.ts';
import { capture } from '../../cli/support.ts';

type Fx = ReturnType<typeof brokerFixture>;
async function call(fx: Fx, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const tool = TOOLS.find((t) => t.name === name)!;
  return tool.run(fx.broker, tool.validate(record(args)));
}
const evidence = [{ ref: 'docs/design.md' }];
const reason = 'The host is reporting the method disposition, not independently verified execution.';
const report = (disposition: string) => ({ id: 'adversarial-review', disposition, why: reason, evidence: ['docs/design.md'] });

async function prepare(fx: Fx, methods?: unknown[]) {
  const reading = await call(fx, 'classify_request', {
    kind: 'manage',
    words: 'Challenge this design with adversarial review.',
    deliverable: { kind: 'decision/brief' },
    skill: 'adversarial-review',
    intent: { outcome: 'Challenge the design.', path: 'review' },
    stakes: { reversible: true, affects: [] },
  });
  assert.equal(reading.selectedWorkflow.workflowId, 'decision-support');
  assert.equal(reading.requestedMethod.binding, 'supplemental');
  const started = await call(fx, 'start_outcome', { workflowId: 'decision-support', intake: reading.intake });
  const runId = started.run.id;
  const next = () => call(fx, 'claim_work', { runId, includeSkillBody: false });
  const plan = (await next()).work;
  assert.equal(plan.requestedMethod.id, 'adversarial-review');
  assert.equal(plan.requestedMethod.digest, fx.broker.skills.get('adversarial-review')!.digest);
  await call(fx, 'submit_work', {
    stepRunId: plan.stepRunId,
    token: plan.token,
    output: { plan: 'Inspect and challenge.', assumptions: [], blockers: [] },
  });
  const work = (await next()).work;
  assert.equal(work.skill.id, 'decision-framing');
  assert.equal(work.requestedMethod.binding, 'supplemental');
  const done = await call(fx, 'submit_work', {
    stepRunId: work.stepRunId,
    token: work.token,
    output: {
      summary: 'Design reviewed.',
      findings: ['Keep the kernel isolated.'],
      changes: [],
      artifact: null,
      ...(methods ? { methods } : {}),
    },
    evidence,
  });
  assert.equal(done.step.state, 'succeeded', JSON.stringify(done));
  return { runId, final: (await next()).work };
}

test('a requested method cannot disappear; missing and malformed reports are correctable on the same final lease', async () => {
  const fx = brokerFixture();
  try {
    const { runId, final } = await prepare(fx, [report('deferred')]);
    assert.equal(final.requestedMethod.status, 'reported_deferred');
    const before = getStep(fx.broker.store, final.stepRunId)!;
    const submit = (methods?: unknown[]) =>
      call(fx, 'submit_work', {
        stepRunId: final.stepRunId,
        token: final.token,
        output: { verification: 'Inspected the review.', limits: [], ...(methods ? { methods } : {}) },
        evidence,
      });
    for (const methods of [
      undefined,
      [{ ...report('skipped'), why: '' }],
      [report('applied')],
      [{ ...report('applied'), obligations: [{ obligation: 'Challenge', section: '/missing', evidence: ['docs/design.md'] }] }],
    ]) {
      const refused = await submit(methods);
      assert.equal(refused.step.state, 'leased', JSON.stringify(refused));
      assert.equal(refused.validation[0].validator, 'requested_method_report');
      assert.equal(getStep(fx.broker.store, final.stepRunId)!.attempts, before.attempts);
      assert.equal(getStep(fx.broker.store, final.stepRunId)!.leaseUntil, before.leaseUntil);
    }
    const empty = await call(fx, 'submit_work', { stepRunId: final.stepRunId, token: final.token, noData: true, output: {} });
    assert.equal(empty.validation[0].validator, 'requested_method_report', 'noData cannot erase a requested method');
    assert.equal(empty.step.state, 'leased');
    const corrected = await submit([report('skipped')]);
    assert.equal(corrected.run.state, 'succeeded', JSON.stringify(corrected));
    const body = getDeliverable(fx.broker.store, corrected.deliverable.id)!.body as any;
    assert.equal(body.requestedMethod.status, 'reported_skipped');
    assert.equal(body.requestedMethod.reason, reason);
    assert.equal((getRun(fx.broker.store, runId)!.bindings as any).requestedMethod.digest, final.requestedMethod.digest);
    const quality = skillQuality(fx.broker.store, { skill: 'adversarial-review' })[0]!;
    assert.equal(quality.steps, 0, 'supplemental methods do not inherit bound-step success');
    assert.deepEqual(quality.applicationReports, { applied: 0, skipped: 1, deferred: 0, unreported: 0 });
    assert.equal(quality.observedExecutionSteps, 0);
    // Simulate history predating method receipts; raw host input is not an accepted report.
    const old = listSteps(fx.broker.store, runId).find((s) => s.stepId === 'do')!;
    const historical: Record<string, unknown> = {
      ...(old.output as Record<string, unknown>),
      methods: [{ id: 'decision-framing', disposition: 'applied', why: reason }],
    };
    delete historical.methodReceipts;
    fx.broker.store.db.prepare('UPDATE step_runs SET output_json = ? WHERE id = ?').run(JSON.stringify(historical), old.id);
    const unknown = skillQuality(fx.broker.store, { skill: 'decision-framing' })[0]!;
    assert.equal(unknown.firstPass, 1, 'original step/check friction remains available');
    assert.deepEqual(unknown.applicationReports, { applied: 0, skipped: 0, deferred: 0, unreported: 1 });
  } finally {
    fx.cleanup();
  }
});

test('prior successful application reports persist and CLI/context separate reports from bound-step friction', async () => {
  const fx = brokerFixture();
  try {
    const applied = {
      ...report('applied'),
      obligations: [{ obligation: 'Challenge assumptions', section: '/findings', evidence: ['docs/design.md'] }],
    };
    const { final } = await prepare(fx, [applied]);
    assert.equal(final.requestedMethod.status, 'reported_applied');
    const result = await call(fx, 'submit_work', {
      stepRunId: final.stepRunId,
      token: final.token,
      output: { verification: 'Review inspected.', limits: [] },
      evidence,
    });
    assert.equal(result.run.state, 'succeeded', JSON.stringify(result));
    const rows = skillQuality(fx.broker.store);
    const bound = rows.find((r) => r.skill === 'decision-framing')!;
    assert.equal(bound.firstPass, 1);
    assert.equal(bound.applicationReports.applied, 0);
    assert.equal(bound.applicationReports.unreported, 1);
    const supplemental = rows.find((r) => r.skill === 'adversarial-review')!;
    assert.equal(supplemental.steps, 0);
    assert.equal(supplemental.applicationReports.applied, 1);
    const context = await call(fx, 'project_context', { topic: 'quality', limit: 100 });
    assert.deepEqual(context.items, rows);
    const json = await capture(() => run(['skill', 'impact', '--json'], fx.box.ctx));
    assert.equal(json.code, 0, json.err);
    assert.deepEqual(JSON.parse(json.out), rows);
    const text = await capture(() => run(['skill', 'impact'], fx.box.ctx));
    assert.match(text.out, /Bound-step check friction; application is host-reported/);
    assert.match(text.out, /latest accepted host reports per run/);
  } finally {
    fx.cleanup();
  }
});

test('older open runs without a requested-method snapshot require recovery instead of silently completing', async () => {
  const fx = brokerFixture();
  try {
    const { runId, final } = await prepare(fx);
    const bindings = { ...(getRun(fx.broker.store, runId)!.bindings as Record<string, unknown>) };
    delete bindings.requestedMethod;
    fx.broker.store.db.prepare('UPDATE workflow_runs SET bindings_json = ? WHERE id = ?').run(JSON.stringify(bindings), runId);
    const resumed = await call(fx, 'claim_work', { runId });
    assert.equal(resumed.work, null);
    assert.equal(resumed.waitingOn.kind, 're_resolve');
    const direct = await call(fx, 'submit_work', {
      stepRunId: final.stepRunId,
      token: final.token,
      output: { verification: 'Inspected.', limits: [], methods: [report('skipped')] },
      evidence,
    });
    assert.equal(direct.step.state, 'leased');
    assert.match(direct.validation[0].problems.join(' '), /Checkpoint, cancel this run and start a new outcome/);
  } finally {
    fx.cleanup();
  }
});
