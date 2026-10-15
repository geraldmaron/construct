import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brokerFixture } from '../broker/support.ts';
import { getRun } from '../../../src/kernel/state/runs.ts';
import { addSource, getSource } from '../../../src/kernel/state/sources.ts';
import { projectResolver } from '../../../src/kernel/source/resolver.ts';
import { snapshotItemRef } from '../../../src/kernel/source/manifest.ts';
import { canonicalReview, prepareSemanticReview, reviewFreshnessProblems, semanticContract, semanticJudgmentProblems } from '../../../src/kernel/workflow/semantic-review.ts';

function fixture() {
  const fx = brokerFixture(), store = fx.broker.store;
  const started = fx.broker.workflow.start({ workflowId: 'managed-outcome', input: { request: 'Review the release evidence' }, trigger: 'manual' });
  store.db.prepare('UPDATE workflow_runs SET bindings_json = ? WHERE id = ?').run(JSON.stringify({ ...(started.run.bindings as object), semanticContract: semanticContract({ words: 'Review the release evidence' }) }), started.run.id);
  const run = getRun(store, started.run.id)!, leased = fx.broker.workflow.claimNext({ runId: run.id }).packet!.leased;
  writeFileSync(join(fx.box.cwd, 'brief.md'), 'A bounded release assessment.');
  addSource(store, { id: 'tracker', kind: 'other', purpose: 'release evidence', authorityLevel: 'informative', sensitivity: 'internal', canRead: true, canWrite: false, at: fx.ctx.now() });
  const report = (items: { ref: string; text: string; url?: string; updatedAt?: string }[]) => fx.broker.sources.reportRead('tracker', { items }, fx.ctx.now(), () => fx.ctx.nextId('alias-test'));
  const prepare = (refs: string[]) => prepareSemanticReview(store, { run, leased, body: { artifact: 'brief.md' }, evidence: refs.map(ref => ({ ref })), resolve: projectResolver(store, fx.box.cwd), at: fx.ctx.now() });
  return { ...fx, store, report, prepare };
}

test('ordinary URL citations preserve complete current closure without duplicating its passages', () => {
  const f = fixture();
  try {
    const items = Array.from({ length: 40 }, (_, i) => ({ ref: `APP-${String(i)}`, url: `https://jira.example/browse/APP-${String(i)}`, text: 'x'.repeat(15_000) }));
    f.report(items);
    const stable = f.prepare(items.map(item => `tracker:${item.ref}`));
    const linked = f.prepare(items.map(item => item.url));
    assert.equal(stable.bundle.evidence.length, items.length);
    assert.equal(linked.bundle.evidence.length, items.length);
    assert.deepEqual(linked.bundle.evidence.map(item => item.ref).sort(), items.map(item => item.url).sort(), 'the reviewer retains the actual cited links');
    assert.equal(linked.bundle.evidence.reduce((n, item) => n + (item.content?.text?.length ?? 0), 0), 600_000);
    assert.ok(Buffer.byteLength(canonicalReview(linked.bundle)) < 700_000);
    assert.deepEqual(reviewFreshnessProblems(f.store, linked, projectResolver(f.store, f.box.cwd)), []);
  } finally { f.cleanup(); }
});

test('mixed source-qualified and URL citations do not duplicate complete source passages', () => {
  const f = fixture();
  try {
    const items = Array.from({ length: 40 }, (_, i) => ({ ref: `APP-${String(i)}`, url: `https://jira.example/browse/APP-${String(i)}`, text: 'x'.repeat(15_000) }));
    f.report(items);
    const prepared = f.prepare(items.flatMap(item => [`tracker:${item.ref}`, item.url]));
    assert.ok(Buffer.byteLength(canonicalReview(prepared.bundle)) < 700_000);
    assert.equal(prepared.bundle.evidence.reduce((n, item) => n + (item.content?.text?.length ?? 0), 0), 600_000);
  } finally { f.cleanup(); }
});

test('deduplicated citation aliases remain legal reviewer references and independently freshness-bound', () => {
  const f = fixture();
  try {
    const url = 'https://jira.example/browse/APP-1';
    f.report([{ ref: 'APP-1', url, text: 'The release needs a decision.' }]);
    const refs = ['tracker:APP-1', url], prepared = f.prepare(refs);
    assert.equal(prepared.bundle.evidence.length, 1);
    const entry = prepared.bundle.evidence[0]!, alias = entry.aliases![0]!;
    assert.deepEqual(new Set([entry.ref, ...(entry.aliases ?? [])]), new Set(refs));
    assert.equal(f.prepare([...refs].reverse()).digest, prepared.digest, 'citation ordering cannot create a new generation');
    for (const ref of refs) {
      const judgment = { checks: prepared.bundle.contract.obligations.map(obligation => ({ id: obligation.id, verdict: 'pass', reason: 'Synthetic reference-validation fixture.', refs: [ref] })) };
      assert.deepEqual(semanticJudgmentProblems(prepared.bundle, judgment), []);
    }
    const resolve = projectResolver(f.store, f.box.cwd);
    assert.deepEqual(reviewFreshnessProblems(f.store, prepared, resolve), []);
    for (const change of ['missing', 'text', 'provenance']) {
      const problems = reviewFreshnessProblems(f.store, prepared, (ref, use) => {
        const content = resolve(ref, use);
        if (ref !== alias || !content) return content;
        if (change === 'missing') return null;
        if (change === 'text') return { ...content, text: 'Changed only behind the alias.' };
        return { ...content, provenance: 'witnessed' };
      });
      assert.ok(problems.some(problem => problem.includes(alias) && problem.includes('alias')), `${change} behind an alias must invalidate review`);
    }
  } finally { f.cleanup(); }
});

test('historical evidence never removes the current contradictory item from review closure', () => {
  const f = fixture();
  try {
    f.report([{ ref: 'APP-1', text: 'The release is ready.', url: 'https://jira.example/browse/APP-1' }]);
    const snapshot = getSource(f.store, 'tracker')!.lastSnapshotId!;
    f.report([{ ref: 'APP-1', text: 'The release is blocked.', url: 'https://jira.example/browse/APP-1' }]);
    const ref = snapshotItemRef(snapshot, 'APP-1'), prepared = f.prepare([ref]);
    assert.equal(prepared.bundle.evidence.find(item => item.ref === ref)?.content?.text, 'The release is ready.');
    assert.equal(prepared.bundle.evidence.find(item => item.ref === 'tracker:APP-1')?.content?.text, 'The release is blocked.');
    assert.equal(prepared.bundle.evidence.length, 2);
  } finally { f.cleanup(); }
});

test('historical metadata remains distinct even when the passage bytes match current evidence', () => {
  const f = fixture();
  try {
    const text = 'The release needs a decision.';
    f.report([{ ref: 'APP-1', text, updatedAt: '2026-09-01T12:00:00Z' }]);
    const snapshot = getSource(f.store, 'tracker')!.lastSnapshotId!;
    f.report([{ ref: 'APP-1', text, updatedAt: '2026-09-02T12:00:00Z' }]);
    const ref = snapshotItemRef(snapshot, 'APP-1'), prepared = f.prepare([ref]);
    assert.equal(prepared.bundle.evidence.length, 2);
    assert.equal(prepared.bundle.evidence.find(item => item.ref === ref)?.content?.updatedAt, '2026-09-01T12:00:00Z');
    assert.equal(prepared.bundle.evidence.find(item => item.ref === 'tracker:APP-1')?.content?.updatedAt, '2026-09-02T12:00:00Z');
  } finally { f.cleanup(); }
});

test('an ambiguous URL cannot suppress either named source item', () => {
  const f = fixture();
  try {
    const url = 'https://jira.example/browse/shared';
    f.report([{ ref: 'APP-1', text: 'The release is ready.', url }, { ref: 'APP-2', text: 'The release is blocked.', url }]);
    assert.equal(projectResolver(f.store, f.box.cwd)(url), null);
    const prepared = f.prepare([url, 'tracker:APP-1']);
    assert.equal(prepared.bundle.evidence.find(item => item.ref === url)?.content, null);
    assert.equal(prepared.bundle.evidence.find(item => item.ref === 'tracker:APP-1')?.content?.text, 'The release is ready.');
    assert.equal(prepared.bundle.evidence.find(item => item.ref === 'tracker:APP-2')?.content?.text, 'The release is blocked.');
  } finally { f.cleanup(); }
});
