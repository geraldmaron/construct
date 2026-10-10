/** Approved validation retries stay independent of expired lease recovery. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { record } from '../../../src/kernel/broker/definition.ts';
import { getStep, listAttempts } from '../../../src/kernel/state/steps.ts';
import { brokerFixture, observedVerification } from './support.ts';

const call = async (fx: ReturnType<typeof brokerFixture>, name: string, args: Record<string, unknown> = {}): Promise<any> => {
  const tool = TOOLS.find((entry) => entry.name === name)!;
  return tool.run(fx.broker, tool.validate(record(args)));
};
const claim = async (fx: ReturnType<typeof brokerFixture>, runId: string) => (await call(fx, 'claim_work', { runId })).work;
const submit = (fx: ReturnType<typeof brokerFixture>, work: any, output: Record<string, unknown>, evidence: { ref: string }[] = []) =>
  call(fx, 'submit_work', { stepRunId: work.stepRunId, token: work.token, output, evidence });
const decision = async (fx: ReturnType<typeof brokerFixture>, runId: string) => {
  const pending = await call(fx, 'inbox');
  const found = pending.find((entry: { run: string; decisionKind: string }) => entry.run === runId && entry.decisionKind === 'decision');
  assert.ok(found, JSON.stringify(pending));
  return found.id;
};

for (const expirations of [0, 1, 2]) {
  for (const approval of ['another attempt', 'accept with these problems']) {
    test(`${approval} grants one validation retry after ${expirations} expired leases and can finish without a waiver`, async () => {
      let time = Date.parse('2026-09-02T12:00:00.000Z');
      const fx = brokerFixture('interactive', { now: () => new Date(time).toISOString() });
      try {
        const started = await call(fx, 'start_outcome', { workflowId: 'managed-outcome', input: { request: 'Write a local design note' } });
        const runId = started.run.id;
        let work = await claim(fx, runId);
        const planId = work.stepRunId;
        for (let index = 0; index < expirations; index++) {
          time += 31 * 60 * 1000;
          work = await claim(fx, runId);
          assert.equal(work.stepRunId, planId);
        }
        assert.equal(listAttempts(fx.broker.store, planId).filter((attempt) => attempt.outcome === 'expired').length, expirations);
        const invalid = { assumptions: [], blockers: [] }; // Missing the required plan.
        assert.equal((await submit(fx, work, invalid)).step.state, 'ready');
        assert.equal((await submit(fx, await claim(fx, runId), invalid)).step.state, 'waiting_for_decision');
        assert.equal((await claim(fx, runId)), null);

        await call(fx, 'decide', { decisionId: await decision(fx, runId), resolution: approval });
        work = await claim(fx, runId);
        // A schema waiver cannot authorize a newly failing method report.
        const retryOutput = approval === 'another attempt' ? invalid : { ...invalid, methods: [{ id: 'unregistered-method', disposition: 'applied', why: 'unknown method' }] };
        const retried = await submit(fx, work, retryOutput);
        assert.equal(retried.step.state, 'waiting_for_decision', 'one approved attempt must not become extra retries after expiration');
        if (approval === 'accept with these problems') assert.ok(retried.validation.some((entry: { validator: string; ok: boolean }) => entry.validator === 'method_reports' && !entry.ok));
        assert.equal(getStep(fx.broker.store, planId)!.maxAttempts, 3);
        assert.equal(getStep(fx.broker.store, planId)!.output, null, 'no new failure was silently waived');
        assert.equal((await claim(fx, runId)), null);

        await call(fx, 'decide', { decisionId: await decision(fx, runId), resolution: 'another attempt' });
        const fixed = await submit(fx, await claim(fx, runId), { plan: ['Read the design and write a note'], assumptions: [], blockers: [] });
        assert.equal(fixed.step.state, 'succeeded');
        assert.equal(getStep(fx.broker.store, planId)!.maxAttempts, 4);
        assert.equal(getStep(fx.broker.store, planId)!.attempts, expirations + 4);
        assert.equal((getStep(fx.broker.store, planId)!.output as { waived?: unknown }).waived, undefined, 'another attempt ends the previous waiver');

        writeFileSync(join(fx.box.cwd, 'retry-note.md'), 'Keep the kernel host-agnostic.\n');
        const produced = await submit(fx, await claim(fx, runId), { summary: 'Wrote a local design note', findings: ['Keep the kernel host-agnostic'], changes: ['retry-note.md'], artifact: 'retry-note.md' }, [{ ref: 'docs/design.md' }]);
        assert.equal(produced.step.state, 'succeeded', JSON.stringify(produced.validation));
        const verify = await claim(fx, runId);
        const done = await submit(fx, verify, { verification: await observedVerification(fx, verify), passed: true }, [{ ref: 'retry-note.md' }]);
        assert.equal(done.run.state, 'succeeded', JSON.stringify(done.validation));
        assert.equal(done.deliverable.trust, 'validated');
        assert.equal(listAttempts(fx.broker.store, planId).filter((attempt) => attempt.outcome === 'expired').length, expirations);
      } finally {
        fx.cleanup();
      }
    });
  }
}
