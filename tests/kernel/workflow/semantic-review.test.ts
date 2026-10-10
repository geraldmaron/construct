import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brokerFixture } from '../broker/support.ts';
import { getRun } from '../../../src/kernel/state/runs.ts';
import { appendActivity } from '../../../src/kernel/state/activity.ts';
import { projectResolver } from '../../../src/kernel/source/resolver.ts';
import { addSource, setAuthority } from '../../../src/kernel/state/sources.ts';
import { semanticContract, prepareSemanticReview, readPreparedReview, semanticReviewProblems, semanticJudgmentProblems, reviewFreshnessProblems, type PreparedReview } from '../../../src/kernel/workflow/semantic-review.ts';

function fixture() {
  const fx = brokerFixture(), store = fx.broker.store;
  const started = fx.broker.workflow.start({ workflowId: 'managed-outcome', input: { request: 'Recommend a design based on project evidence' }, trigger: 'manual' });
  const contract = semanticContract({ words: 'Recommend a design based on project evidence', actionScope: 'assessment only' });
  store.db.prepare('UPDATE workflow_runs SET bindings_json = ? WHERE id = ?').run(JSON.stringify({ ...(started.run.bindings as object), semanticContract: contract }), started.run.id);
  const run = getRun(store, started.run.id)!, leased = fx.broker.workflow.claimNext({ runId: run.id }).packet!.leased;
  writeFileSync(join(fx.box.cwd, 'brief.md'), 'Keep the kernel host-agnostic.');
  const resolve = (ref: string) => projectResolver(store, fx.box.cwd)(ref);
  const prepare = (body = { summary: 'Keep the kernel host-agnostic.', artifact: 'brief.md' }) => prepareSemanticReview(store, { run: getRun(store, run.id)!, leased, body, evidence: [{ ref: 'docs/design.md' }], resolve, at: fx.ctx.now() });
  const judgment = (p: PreparedReview) => ({ checks: p.bundle.contract.obligations.map(o => ({ id: o.id, verdict: 'pass' as const, reason: 'Synthetic contract-test judgment, not native qualification evidence.', refs: ['body', 'docs/design.md'] })) });
  const observe = (p: PreparedReview, patch: object = {}, channel = 'host_semantic') => appendActivity(store, { at: fx.ctx.now(), kind: 'semantic.executed', runId: run.id, stepRunId: leased.id, channel, payload: { preparedRef: p.ref, bundleDigest: p.digest, attempt: leased.token, invocation: { id: 'synthetic-invocation', host: 'codex', hostVersion: 'test', model: 'test', sessionId: 'synthetic-independent-session', completed: true, exitStatus: 0, timedOut: false, transcriptDigest: 'test' }, judgment: judgment(p), problems: [], ...patch } });
  return { ...fx, store, run, leased, prepare, resolve, judgment, observe };
}

test('semantic review needs a real adapter channel, exact coverage and current generation; producer assertions and command receipts cannot supply it', () => {
  const f = fixture();
  try {
    const p = f.prepare();
    assert.equal(f.prepare().ref, p.ref, 'identical preparation is idempotent');
    assert.deepEqual(readPreparedReview(f.store, p.ref), p);
    assert.match(semanticReviewProblems(f.store, p, f.resolve).join(), /No adapter-observed/);
    f.observe(p, {}, 'relay');
    appendActivity(f.store, { at: f.ctx.now(), kind: 'verification.executed', runId: f.run.id, stepRunId: f.leased.id, channel: 'host_command', payload: { semanticSupportVerified: true, checks: f.judgment(p).checks } });
    assert.match(semanticReviewProblems(f.store, p, f.resolve).join(), /No adapter-observed/);
    f.observe(p);
    assert.deepEqual(semanticReviewProblems(f.store, p, f.resolve), []);
    f.observe(p, { attempt: f.leased.token + 1 });
    assert.match(semanticReviewProblems(f.store, p, f.resolve).join(), /observed independent invocation/);
    f.observe(p);
    writeFileSync(join(f.box.cwd, 'brief.md'), 'Move model execution into the kernel.');
    assert.match(semanticReviewProblems(f.store, p, f.resolve).join(), /brief.md: review content/);
    const changed = f.prepare();
    assert.notEqual(changed.digest, p.digest);
    assert.match(semanticReviewProblems(f.store, changed, f.resolve).join(), /No adapter-observed/);
  } finally { f.cleanup(); }
});

test('every frozen obligation requires an explicit supported judgment; empty findings or overall pass cannot replace coverage', () => {
  const f = fixture();
  try {
    const p = f.prepare(), good = f.judgment(p);
    assert.deepEqual(semanticJudgmentProblems(p.bundle, good), []);
    for (const value of [{ passed: true, findings: [] }, { checks: [] }, { checks: good.checks.slice(1) }, { checks: [...good.checks, good.checks[0]] }, { checks: good.checks.map((c, i) => i ? c : { ...c, verdict: 'unknown' }) }, { checks: good.checks.map((c, i) => i ? c : { ...c, refs: ['invented-source'] }) }, { checks: good.checks.map((c, i) => i ? c : { ...c, reason: '' }) }]) assert.ok(semanticJudgmentProblems(p.bundle, value).length);
    assert.match(p.bundle.contract.obligations.find(o => o.id === 'reasoning')!.criterion, /need not include optional subtraction/);
  } finally { f.cleanup(); }
});

test('source bytes, authority, provenance, access and final body invalidate the previous review independently of provider timestamps', () => {
  const f = fixture();
  try {
    addSource(f.store, { id: 'design', kind: 'directory', purpose: 'design', locator: join(f.box.cwd, 'docs'), authorityLevel: 'informative', sensitivity: 'internal', canRead: true, canWrite: false, at: f.ctx.now() });
    const p = f.prepare();
    f.observe(p);
    assert.deepEqual(semanticReviewProblems(f.store, p, f.resolve), []);
    setAuthority(f.store, 'design', 'architecture', true);
    assert.match(reviewFreshnessProblems(f.store, p, f.resolve).join(), /authority/);
    const authorized = f.prepare(); f.observe(authorized);
    writeFileSync(join(f.box.cwd, 'docs/design.md'), 'Move execution into the kernel.');
    assert.match(reviewFreshnessProblems(f.store, authorized, f.resolve).join(), /content/);
    const changed = f.prepare({ summary: 'A new conclusion in the final body.', artifact: 'brief.md' });
    assert.notEqual(changed.digest, authorized.digest);
    assert.match(semanticReviewProblems(f.store, changed, f.resolve).join(), /No adapter-observed/);
  } finally { f.cleanup(); }
});

test('missing, partial and oversized held representations cannot silently pass review', () => {
  const f = fixture();
  try {
    const prepare = (resolve: typeof f.resolve) => prepareSemanticReview(f.store, { run: f.run, leased: f.leased, body: { artifact: 'brief.md' }, evidence: [{ ref: 'docs/design.md' }], resolve, at: f.ctx.now() });
    const partial = prepare(ref => { const r = f.resolve(ref); return r ? { ...r, truncated: true } : null; });
    f.observe(partial);
    assert.match(semanticReviewProblems(f.store, partial, f.resolve).join(), /complete held text/);
    assert.throws(() => prepare(ref => ({ ref, kind: 'file', provenance: 'witnessed', text: 'x'.repeat(600_000) })), /512 KiB/);
    assert.equal(readPreparedReview(f.store, 'review:999999'), null);
  } finally { f.cleanup(); }
});
