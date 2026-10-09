/** Intended checks cannot be replaced by an unrelated successful command. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS } from '../../src/kernel/broker/tools.ts';
import { executeVerification } from '../../src/hosts/verification.ts';
import { projectResolver } from '../../src/kernel/source/resolver.ts';
import { selectedVerifier } from '../../src/kernel/workflow/verifier-contract.ts';
import { brokerFixture } from '../kernel/broker/support.ts';

for (const mode of ['pass', 'bad-artifact', 'unknown', 'missing-check', 'other-check', 'wrong-command', 'changed-verifier', 'changed-rubric', 'changed-during', 'changed-after', 'nonzero', 'fake-receipt'] as const) test(`public intended verification: ${mode}`, async () => {
  const fx = brokerFixture();
  const call = async (name: string, input: Record<string, unknown>): Promise<any> => {
    const t = TOOLS.find((t) => t.name === name)!;
    return t.run(fx.broker, t.validate(input));
  };
  try {
    const grader = `import fs from 'node:fs';\nconst text=fs.readFileSync('note.md','utf8');\nconst checks={kernel_boundary:text.includes('host-agnostic')?'pass':'fail'};\n${mode === 'unknown' ? "checks.kernel_boundary='unknown';" : ''}\n${mode === 'missing-check' ? 'delete checks.kernel_boundary;' : ''}\n${mode === 'other-check' ? "delete checks.kernel_boundary; checks.nonempty='pass';" : ''}\n${mode === 'changed-during' ? "fs.writeFileSync('rubric.md','weakened criteria');" : ''}\nconsole.log(JSON.stringify({formatVersion:1,checks}));\n${mode === 'nonzero' ? 'process.exitCode=2;' : ''}`;
    writeFileSync(join(fx.box.cwd, 'verify.mjs'), grader);
    writeFileSync(join(fx.box.cwd, 'rubric.md'), 'The artifact must preserve the host-agnostic kernel boundary.');
    const contract = { id: 'kernel-boundary', version: '1', argv: [process.execPath, 'verify.mjs'], files: ['verify.mjs', 'rubric.md'], checks: ['kernel_boundary'] };
    const started = fx.broker.workflow.start({ workflowId: 'managed-outcome', input: { request: 'Prepare a local design note' }, trigger: 'manual' });
    const runId = started.run.id;
    const claim = async () => (await call('claim_work', { runId })).work;
    const submit = (work: any, output: unknown, evidence: unknown[] = []) => call('submit_work', { stepRunId: work.stepRunId, owner: work.owner, token: work.token, output, evidence });
    const planned = await submit(await claim(), { plan: ['Read the design and write a note'], assumptions: [], blockers: [], verificationContract: contract, verificationContractReceipt: { digest: 'model-forged' } });
    assert.equal(planned.step.state, 'succeeded');
    const frozen = selectedVerifier(fx.broker.store, runId)!;
    assert.ok(frozen.digest && frozen.digest !== 'model-forged');
    assert.equal(frozen.files.length, 2);
    writeFileSync(join(fx.box.cwd, 'note.md'), mode === 'bad-artifact' ? 'The kernel is host-specific.' : 'Keep the kernel host-agnostic.');
    const produced = await submit(await claim(), { summary: 'Design note written', findings: [], changes: ['note.md'], artifact: 'note.md' }, [{ ref: 'docs/design.md' }]);
    assert.equal(produced.step.state, 'succeeded', JSON.stringify(produced.validation));
    const work = await claim();
    const input = { store: fx.broker.store, runId, stepRunId: work.stepRunId, token: work.token, root: fx.box.cwd, env: fx.ctx.env, resolve: (ref: string) => projectResolver(fx.broker.store, fx.box.cwd)(ref), now: fx.ctx.now, subjects: ['note.md'], argv: contract.argv };
    if (mode === 'changed-verifier') writeFileSync(join(fx.box.cwd, 'verify.mjs'), "console.log(JSON.stringify({formatVersion:1,checks:{kernel_boundary:'pass'}}))");
    if (mode === 'changed-rubric') writeFileSync(join(fx.box.cwd, 'rubric.md'), 'Any result passes.');
    if (['wrong-command', 'changed-verifier', 'changed-rubric'].includes(mode)) {
      await assert.rejects(executeVerification({ ...input, ...(mode === 'wrong-command' ? { argv: [process.execPath, '-e', 'process.exit(0)'] } : {}) }), /intended|frozen/);
      return;
    }
    let verified: Record<string, unknown> = await executeVerification(input);
    if (mode === 'changed-after') writeFileSync(join(fx.box.cwd, 'rubric.md'), 'Changed after execution.');
    if (mode === 'fake-receipt') verified = { ...verified, executionRef: 'execution:999999', receipt: { ...(verified.receipt as object), intendedVerification: { digest: frozen.digest, satisfied: true } } };
    const done = await submit(work, { verification: verified, passed: true }, [{ ref: 'note.md' }]);
    assert.equal(done.run.state === 'succeeded', mode === 'pass', JSON.stringify(done.validation));
    if (mode !== 'pass') assert.ok(done.validation.some((v: any) => v.validator === 'execution_required' && !v.ok));
  } finally { fx.cleanup(); }
});

test('intended contract is frozen before production and cannot be introduced with a verification result', async () => {
  const fx = brokerFixture();
  try {
    const run = fx.broker.workflow.start({ workflowId: 'managed-outcome', input: { request: 'Write note' }, trigger: 'manual' });
    let leased = fx.broker.workflow.claimNext({ runId: run.run.id }).packet!.leased;
    const resolve = (ref: string) => projectResolver(fx.broker.store, fx.box.cwd)(ref);
    const plan = fx.broker.workflow.submit({ leased, output: { plan: ['Write note'], assumptions: [], blockers: [] }, evidence: [], resolve });
    assert.equal(plan.step.state, 'succeeded');
    leased = fx.broker.workflow.claimNext({ runId: run.run.id }).packet!.leased;
    writeFileSync(join(fx.box.cwd, 'note.md'), 'Keep the kernel host-agnostic.');
    const result = fx.broker.workflow.submit({ leased, output: { summary: 'Note written', findings: [], changes: ['note.md'], artifact: 'note.md', verificationContract: { id: 'late', version: '1', argv: [process.execPath, '-e', 'process.exit(0)'], files: ['docs/design.md'], checks: ['already-done'] } }, evidence: [{ ref: 'docs/design.md' }], resolve });
    assert.ok(result.validation.some((v) => v.validator === 'verification_contract' && !v.ok));
    assert.equal(selectedVerifier(fx.broker.store, run.run.id), null);
  } finally { fx.cleanup(); }
});
