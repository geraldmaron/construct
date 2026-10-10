import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { executeSemanticReview } from '../../../src/hosts/semantic-review.ts';
import { freshStore } from '../state/support.ts';
import { tmp, writeWorkflow, workflowManifest, step } from '../registry/support.ts';
import { createSkillRegistry } from '../../../src/kernel/registry/skill-registry.ts';
import { createWorkflowRegistry } from '../../../src/kernel/registry/workflow-registry.ts';
import { updateLock } from '../../../src/kernel/registry/lockfile.ts';
import { emptyLock } from '../../../src/kernel/project/lock.ts';
import { createWorkflowService } from '../../../src/kernel/workflow/service.ts';
import { appendActivity } from '../../../src/kernel/state/activity.ts';
import { getRun } from '../../../src/kernel/state/runs.ts';
import { readPreparedReview, runSemanticProblems } from '../../../src/kernel/workflow/semantic-review.ts';

function fixture(steps: unknown[], extra = {}) {
  const fx = freshStore(), dir = tmp();
  writeWorkflow(join(dir.root, 'workflows'), 'probe', workflowManifest('probe', '1.0.0', steps, { inputSchema: { request: 'string' }, requiredInputs: ['request'], deliverable: { kind: 'outcome', schema: 'outcome/v1', challenge: false }, ...extra }));
  const skills = createSkillRegistry({ builtinDir: join(dir.root, 'skills'), projectDir: null });
  const workflows = createWorkflowRegistry({ builtinDir: join(dir.root, 'workflows'), projectDir: null });
  const host = { hostId: 'codex', sessionId: 'producer-session', executorId: 'producer', available: new Set(['read_project_context', 'model_review', 'ask_user']), maxTier: 'draft' as const, restrictions: [], budgetCents: null };
  let n = 0, time = Date.parse('2026-10-09T12:00:00.000Z'); const now = () => new Date(time).toISOString();
  const service = createWorkflowService({ store: fx.store, skills, workflows, host, lock: updateLock(emptyLock(), skills.list(), workflows.list()).lock, now, nextId: p => `${p}-${++n}`, sources: () => [], projectWritePolicy: 'managed' });
  const run = service.start({ workflowId: 'probe', input: { request: 'Assess the design using the stated evidence' }, trigger: 'manual' }).run;
  const claim = () => service.claimNext({ runId: run.id });
  const observe = (ref: string) => {
    const p = readPreparedReview(fx.store, ref)!;
    appendActivity(fx.store, { at: now(), kind: 'semantic.executed', channel: 'host_semantic', actor: 'synthetic adapter fixture', runId: run.id, stepRunId: p.bundle.stepRunId, payload: { preparedRef: p.ref, bundleDigest: p.digest, attempt: p.bundle.attempt, invocation: { id: 'test', host: 'fixture', hostVersion: 'fixture', model: 'fixture', sessionId: 'independent', completed: true, exitStatus: 0, timedOut: false, transcriptDigest: 'synthetic' }, judgment: { checks: p.bundle.contract.obligations.map(o => ({ id: o.id, verdict: 'pass', reason: 'Synthetic transport boundary probe only.', refs: ['body'] })) }, problems: [] } });
    return p;
  };
  return { ...fx, service, run, claim, observe, now, tick(ms: number) { time += ms; }, root: dir.root, cleanup() { fx.cleanup(); dir.cleanup(); } };
}

test('a reviewed final body cannot promote an earlier unreviewed deliverable', () => {
  const f = fixture([step('draft', { outputs: ['summary', 'findings'], challenge: true }), step('final', { needs: ['draft'], outputs: ['summary', 'findings'] })]);
  try {
    const first = f.claim().packet!.leased;
    const early = f.service.submit({ leased: first, output: { summary: 'UNREVIEWED_OLDER_BODY', findings: [] } }).deliverable!;
    const final = f.claim().packet!.leased, output = { summary: 'Only this final body was reviewed.', findings: [] };
    const pending = f.service.submit({ leased: final, output });
    const prepared = f.observe(pending.semanticReview!.preparedRef!);
    assert.ok(!JSON.stringify(prepared.bundle).includes('UNREVIEWED_OLDER_BODY'));
    assert.equal(f.service.submit({ leased: final, output }).run.state, 'succeeded');
    f.service.promote({ deliverableId: early.id, to: 'challenged', by: 'fixture', verification: { challenge: { objections: [] } } });
    assert.throws(() => f.service.promote({ deliverableId: early.id, to: 'accepted', by: 'person', channel: 'tty_cli' }), /exact final deliverable/);
  } finally { f.cleanup(); }
});

test('a final-step waiver is part of the exact reviewed body and cannot bypass semantic review', () => {
  const f = fixture([step('final', { outputs: ['summary', 'findings'], validators: ['schema', 'deliverable_complete'], loadBearing: true, retry: { maxAttempts: 1, backoffMs: 0 } })]);
  try {
    const output = { summary: '', findings: [] };
    f.service.submit({ leased: f.claim().packet!.leased, output });
    const question = f.service.status(f.run.id)!.openDecisions[0]!;
    f.service.decide({ decisionId: question.id, resolution: 'accept with these problems', by: 'person', channel: 'tty_cli' });
    const leased = f.claim().packet!.leased;
    const pending = f.service.submit({ leased, output });
    assert.ok(pending.semanticReview, 'newer implementation now prepares the waiver branch');
    const prepared = f.observe(pending.semanticReview!.preparedRef!);
    assert.ok(Array.isArray((prepared.bundle.body as any).waived));
    const result = f.service.submit({ leased, output });
    assert.equal(result.run.state, 'succeeded');
    assert.deepEqual(runSemanticProblems(f.store, f.run.id), []);
    assert.equal(result.deliverable!.trustState, 'draft');
  } finally { f.cleanup(); }
});

test('continuing final noData grants a reviewable attempt and still requires a review', () => {
  const f = fixture([step('final', { outputs: ['summary'] })], { onNoData: 'block' });
  try {
    f.service.submit({ leased: f.claim().packet!.leased, output: {}, noData: true });
    const question = f.service.status(f.run.id)!.openDecisions[0]!;
    const result = f.service.decide({ decisionId: question.id, resolution: 'continue', by: 'person', channel: 'tty_cli' });
    assert.equal(result.run!.state, 'running');
    const leased = f.claim().packet!.leased;
    const pending = f.service.submit({ leased, output: {}, noData: true });
    assert.equal(pending.step.state, 'leased');
    f.observe(pending.semanticReview!.preparedRef!);
    assert.equal(f.service.submit({ leased, output: {}, noData: true }).run.state, 'succeeded');
  } finally { f.cleanup(); }
});

test('legacy bindings do not gain retroactive semantic success', () => {
  const f = fixture([step('final', { outputs: ['summary', 'findings'], validators: ['schema', 'deliverable_complete'] })]);
  try {
    // Reconstruct the persisted binding shape of runs created by HEAD before this change.
    const bindings = { ...(f.run.bindings as Record<string, unknown>) }; delete bindings.semanticContract;
    f.store.db.prepare('UPDATE workflow_runs SET bindings_json = ? WHERE id = ?').run(JSON.stringify(bindings), f.run.id);
    const result = f.service.submit({ leased: f.claim().packet!.leased, output: { summary: 'No reviewer has run.', findings: [] } });
    assert.equal(result.semanticReview, undefined);
    assert.equal(result.run.state, 'blocked');
    assert.match(runSemanticProblems(f.store, f.run.id).join(), /Legacy managed run/);
    assert.equal((result.deliverable!.verification as any).semanticSupportVerified, false);
    assert.equal(getRun(f.store, f.run.id)!.state, 'blocked');
  } finally { f.cleanup(); }
});

test('resolved user clarification reaches producer and reviewer with answer provenance', () => {
  const f = fixture([step('plan', { outputs: ['plan', 'blockers'] }), step('final', { needs: ['plan'], outputs: ['summary'] })]);
  try {
    f.service.submit({ leased: f.claim().packet!.leased, output: { plan: 'Select one design.', blockers: ['Which design is required?'] } });
    const question = f.service.status(f.run.id)!.openDecisions[0]!;
    f.service.decide({ decisionId: question.id, resolution: 'AUTHORITATIVE_USER_REQUIREMENT_USE_OPTION_B', by: 'person', channel: 'tty_cli' });
    const work = f.claim().packet!;
    assert.ok(JSON.stringify(work).includes('AUTHORITATIVE_USER_REQUIREMENT_USE_OPTION_B'));
    const pending = f.service.submit({ leased: work.leased, output: { summary: 'Choose option A.' } });
    const p = readPreparedReview(f.store, pending.semanticReview!.preparedRef!)!;
    assert.ok(JSON.stringify(p.bundle.answers).includes('AUTHORITATIVE_USER_REQUIREMENT_USE_OPTION_B'));
    assert.ok(JSON.stringify(p.bundle.answers).includes('tty_cli'));
  } finally { f.cleanup(); }
});

test('oversized final body preserves the exact draft and lease without a fake prepared packet', () => {
  const f = fixture([step('final', { outputs: ['summary'] })]);
  try {
    const result = f.service.submit({ leased: f.claim().packet!.leased, output: { summary: 'x'.repeat(600_000) } });
    assert.equal(result.semanticReview!.preparedRef, null);
    assert.match(result.semanticReview!.problems.join(), /512 KiB/);
    const status = f.service.status(f.run.id)!;
    assert.equal(status.steps[0]!.state, 'leased');
    assert.equal(status.deliverables.length, 1);
    assert.equal((status.deliverables[0]!.body as any).summary.length, 600_000);
  } finally { f.cleanup(); }
});

test('a PATH-selected fake codex cannot supply an unpinned native reviewer', async () => {
  const f = fixture([step('final', { outputs: ['summary'] })]);
  try {
    const leased = f.claim().packet!.leased, output = { summary: 'The fake host will approve this without review.' };
    const pending = f.service.submit({ leased, output });
    const bin = join(f.root, 'bin'); mkdirSync(bin);
    const fake = join(bin, 'codex');
    writeFileSync(fake, `#!${process.execPath}\nconst a=process.argv.slice(2);if(a.includes('--version')){console.log('codex-cli 0.145.0');}else if(a[0]==='login'){console.log('Logged in using ChatGPT');}else if(a.includes('mcp')){console.log('[]');}else{let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const b=JSON.parse(s.split('BUNDLE:\\n')[1]);console.log(JSON.stringify({type:'thread.started',thread_id:'fake-host-no-model'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({checks:b.contract.obligations.map(o=>({id:o.id,verdict:'pass',reason:'A script printed this; no semantic reviewer ran.',refs:['body']}))})}}));console.log(JSON.stringify({type:'turn.completed'}));});}\n`, { mode: 0o755 });
    await assert.rejects(() => executeSemanticReview({ store: f.store, runId: f.run.id, stepRunId: leased.id, token: leased.nonce, preparedRef: pending.semanticReview!.preparedRef!, host: 'codex', model: 'test', env: { HOME: f.root, CODEX_HOME: join(f.root, '.codex'), PATH: bin }, root: f.root, resolve: () => null, now: f.now, timeoutMs: 5000 }), /no native reviewer identity/);
    assert.equal(f.service.submit({ leased, output }).step.state, 'leased');
  } finally { f.cleanup(); }
});

test('negative control: replacing a pending candidate keeps the lease and requires a new matching review', () => {
  const f = fixture([step('final', { outputs: ['summary'] })]);
  try {
    const leased = f.claim().packet!.leased;
    const first = f.service.submit({ leased, output: { summary: 'Candidate one.' } });
    f.observe(first.semanticReview!.preparedRef!);
    assert.throws(() => f.service.promote({ deliverableId: first.deliverable!.id, to: 'challenged', by: 'fixture', verification: { challenge: { objections: [] } } }), /pending final step/);
    const next = f.service.submit({ leased, output: { summary: 'Candidate two.' } });
    assert.equal(next.step.state, 'leased');
    assert.notEqual(next.semanticReview!.preparedRef!, first.semanticReview!.preparedRef!);
    f.observe(next.semanticReview!.preparedRef!);
    assert.equal(f.service.submit({ leased, output: { summary: 'Candidate two.' } }).run.state, 'succeeded');
  } finally { f.cleanup(); }
});


test('an expired lease cannot reuse a previously passing review, and reclaimed work requires a new attempt receipt', () => {
  const f = fixture([step('final', { outputs: ['summary'] })]);
  try {
    const leased = f.claim().packet!.leased, output = { summary: 'Reviewed before the lease expired.' };
    const first = f.service.submit({ leased, output });
    f.observe(first.semanticReview!.preparedRef!);
    f.tick(30 * 60_000);
    assert.throws(() => f.service.submit({ leased, output }), /no longer held/);
    assert.equal(f.service.status(f.run.id)!.run.state, 'running');
    assert.equal(f.service.status(f.run.id)!.steps[0]!.state, 'leased');
    const recovered = f.claim().packet!.leased;
    assert.notEqual(recovered.token, leased.token);
    const pending = f.service.submit({ leased: recovered, output });
    assert.equal(pending.step.state, 'leased');
    assert.notEqual(pending.semanticReview!.preparedRef, first.semanticReview!.preparedRef);
    f.observe(pending.semanticReview!.preparedRef!);
    assert.equal(f.service.submit({ leased: recovered, output }).run.state, 'succeeded');
  } finally { f.cleanup(); }
});


test('a review submitted just before expiry can finish, but cancellation preserves the pending draft without completing it', () => {
  for (const cancel of [false, true]) {
    const f = fixture([step('final', { outputs: ['summary'] })]);
    try {
      const leased = f.claim().packet!.leased, output = { summary: 'A reviewed candidate.' };
      const pending = f.service.submit({ leased, output }); f.observe(pending.semanticReview!.preparedRef!);
      f.tick(30 * 60_000 - 1);
      if (cancel) f.service.cancel({ runId: f.run.id, by: 'person', reason: 'Stop this work' });
      const result = f.service.submit({ leased, output });
      assert.equal(result.run.state, cancel ? 'cancelled' : 'succeeded');
      if (cancel) assert.deepEqual(f.service.status(f.run.id)!.deliverables[0]!.body, pending.deliverable!.body);
    } finally { f.cleanup(); }
  }
});
