import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { executeVerification } from '../../src/hosts/verification.ts';
import { appendActivity } from '../../src/kernel/state/activity.ts';
import { TOOLS } from '../../src/kernel/broker/tools.ts';
import { record } from '../../src/kernel/broker/definition.ts';
import { run } from '../../src/cli/index.ts';
import { capture } from '../cli/support.ts';
import { executionCheck } from '../../src/kernel/workflow/verification.ts';
import { projectResolver } from '../../src/kernel/source/resolver.ts';
import { brokerFixture } from '../kernel/broker/support.ts';

test('host command receipts reject failing, missing, replayed, timed out and changed subjects', async () => {
  const fx = brokerFixture();
  try {
    const b = fx.broker;
    const run = b.workflow.start({ workflowId: 'managed-outcome', input: { request: 'inspect project' }, trigger: 'manual' });
    const lease = b.workflow.claimNext({ runId: run.run.id }).packet!.leased;
    const resolve = (ref: string) => projectResolver(b.store, fx.box.cwd)(ref);
    const base = { store: b.store, runId: run.run.id, stepRunId: lease.id, token: lease.nonce, root: fx.box.cwd, env: fx.ctx.env, resolve, now: fx.ctx.now, subjects: ['docs/design.md'] };
    const check = (output: unknown, attempt = lease.token) => executionCheck(b.store, { runId: run.run.id, stepRunId: lease.id, attempt, output, resolve, subjects: ['docs/design.md'] });
    assert.equal(check({ verification: { result: 'looks fine', executionVerified: true } }).ok, false);
    const bad = await executeVerification({ ...base, argv: [process.execPath, '-e', 'process.exit(7)'] });
    assert.equal(bad.receipt.exitStatus, 7);
    assert.equal(check({ verification: bad }).ok, false);
    const good = await executeVerification({ ...base, argv: [process.execPath, '-e', 'console.log("actual check completed")'] });
    assert.match(good.receipt.outputExcerpt, /actual check completed/);
    assert.equal(check({ verification: good }).ok, true);
    assert.equal(check({ verification: { ...good, command: "invented test command" } }).ok, false);
    assert.equal(check({ verification: { ...good, exitStatus: 12 } }).ok, false);
    assert.equal(check({ verification: good }, lease.token + 1).ok, false);
    assert.equal(executionCheck(b.store, { runId: 'another', stepRunId: lease.id, attempt: lease.token, output: { verification: good }, resolve, subjects: [] }).ok, false);
    writeFileSync(join(fx.box.cwd, 'docs/design.md'), 'Changed after verification');
    assert.equal(check({ verification: good }).ok, false);
    const changed = await executeVerification({ ...base, argv: [process.execPath, '-e', 'require("node:fs").writeFileSync("docs/design.md", "Changed during command")'] });
    assert.equal(changed.receipt.subjectsStable, false);
    assert.equal(check({ verification: changed }).ok, false);
    const timed = await executeVerification({ ...base, timeoutMs: 30, argv: [process.execPath, '-e', 'setTimeout(()=>{},10000)'] });
    assert.equal(timed.receipt.timedOut, true);
    assert.equal(check({ verification: timed }).ok, false);
    await assert.rejects(executeVerification({ ...base, token: 'wrong', argv: [process.execPath, '-e', 'process.exit(0)'] }), /current unexpired/);
  } finally { fx.cleanup(); }
});


for (const outcome of ['missing', 'failed', 'stale', 'wrong_attempt', 'passed'] as const) test(`required execution gates public submission and CLI completion: ${outcome}`, async () => {
  const fx = brokerFixture();
  const call = async (name: string, args: Record<string, unknown>) => {
    const t = TOOLS.find((t) => t.name === name)!;
    return await t.run(fx.broker, t.validate(record(args))) as any;
  };
  try {
    fx.broker.triggers.define({ id: 'daily', workflowId: 'managed-outcome', kind: 'schedule', scheduleExpression: '0 9 * * *', timezone: 'UTC', adapter: 'cron', overlap: 'skip', maxTier: 'project_write', delivery: {}, input: { request: 'Prepare a local design note' } });
    const fired = fx.broker.triggers.fire({ triggerId: 'daily', firingKey: 'test-day' });
    const runId = fired.runId!;
    const claim = async () => (await call('claim_work', { runId })).work;
    const submit = async (work: any, output: unknown, evidence: unknown[] = []) => call('submit_work', { stepRunId: work.stepRunId, owner: work.owner, token: work.token, output, evidence });
    await submit(await claim(), { plan: ['Read design and write note'], assumptions: [], blockers: [] });
    writeFileSync(join(fx.box.cwd, 'note.md'), 'Keep the kernel host-agnostic.');
    const written = await submit(await claim(), { summary: 'Design note written', findings: ['Keep the kernel host-agnostic'], changes: ['note.md'], artifact: 'note.md' }, [{ ref: 'docs/design.md' }]);
    assert.equal(written.step.state, 'succeeded', JSON.stringify(written.validation));
    const work = await claim();
    let verification: Record<string, unknown> = { result: 'Looked fine', command: 'not actually executed', exitStatus: 0 };
    if (outcome !== 'missing') {
      verification = await executeVerification({ store: fx.broker.store, runId, stepRunId: work.stepRunId, token: work.token, root: fx.box.cwd, env: fx.ctx.env, now: fx.ctx.now, resolve: projectResolver(fx.broker.store, fx.box.cwd), subjects: ['note.md'], argv: [process.execPath, '-e', outcome === 'failed' ? 'process.exit(2)' : 'require("node:assert/strict").match(require("node:fs").readFileSync("note.md","utf8"), /host-agnostic/)'] });
      if (outcome === 'stale') writeFileSync(join(fx.box.cwd, 'note.md'), 'Altered after check.');
      if (outcome === 'wrong_attempt') {
        // Simulate a receipt from an earlier attempt; the public submission must reject it.
        const prior = appendActivity(fx.broker.store, { at: fx.ctx.now(), kind: 'verification.executed', runId, stepRunId: work.stepRunId, payload: { ...(verification.receipt as Record<string, unknown>), attempt: 0 } });
        verification = { ...verification, executionRef: `execution:${prior.id}` };
      }
    }
    const finished = await submit(work, { verification, passed: true }, [{ ref: 'note.md' }]);
    assert.equal(finished.run.state === 'succeeded', outcome === 'passed', JSON.stringify(finished.validation));
    if (outcome !== 'passed') assert.ok(finished.validation.some((v: any) => v.validator === 'execution_required' && !v.ok));
    if (outcome !== 'passed') {
      // Legacy records could already have a terminal success claim: CLI must recheck it.
      fx.broker.store.db.prepare("UPDATE workflow_runs SET state = 'succeeded' WHERE id = ?").run(runId);
      fx.broker.store.db.prepare("UPDATE step_runs SET state = 'succeeded', output_json = ? WHERE id = ?").run(JSON.stringify({ verification, passed: true }), work.stepRunId);
    }
    const result = await capture(() => run(['workflow', 'fire', 'daily', '--key=test-day', '--json'], fx.ctx));
    const response = JSON.parse(result.out);
    assert.equal(response.complete, outcome === 'passed', result.out);
    assert.equal(result.code, outcome === 'passed' ? 0 : 1);
  } finally { fx.cleanup(); }
});
