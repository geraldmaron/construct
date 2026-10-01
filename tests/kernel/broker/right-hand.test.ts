/**
 * tests/kernel/broker/right-hand.test.ts — the journeys a person delegating
 * real work expects: a plain answer can be checked before it is given, what
 * the host read from a tracker is tracked like a folder, what the person has
 * settled governs later work, and stale work can be revised as a linked
 * revision rather than started over.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { record } from '../../../src/kernel/broker/definition.ts';
import { addSource } from '../../../src/kernel/state/sources.ts';
import { listRuns } from '../../../src/kernel/state/runs.ts';
import { listStatements } from '../../../src/kernel/state/profile.ts';
import { listOpenDecisions } from '../../../src/kernel/state/decisions.ts';
import { brokerFixture } from './support.ts';

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
async function call(fx: ReturnType<typeof brokerFixture>, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const t = tool(name);
  return t.run(fx.broker, t.validate(record(args)));
}
async function step(fx: ReturnType<typeof brokerFixture>, runId: string) {
  return (await call(fx, 'claim_work', { runId })).work;
}
async function submit(fx: ReturnType<typeof brokerFixture>, w: any, output: Record<string, unknown>, evidence: { ref: string; excerpt?: string }[]) {
  return call(fx, 'submit_work', { stepRunId: w.stepRunId, owner: w.owner, token: w.token, output, evidence });
}

test('a plain answer can be checked before it is given, and checking records nothing', async () => {
  const fx = brokerFixture();
  try {
    writeFileSync(join(fx.broker.root, 'docs', 'metrics.md'), '429 responses: September 2.1M.\n');
    const before = { runs: listRuns(fx.broker.store, {}).length, statements: listStatements(fx.broker.store).length };
    const bad = await call(fx, 'check_answer', { answer: 'We are at 3.4M 429s a month.', citations: [{ ref: 'docs/metrics.md' }, { ref: 'docs/forecast.md' }] });
    assert.equal(bad.ok, false);
    assert.ok(bad.problems.some((p: { problem: string }) => p.problem.includes('3.4m')));
    assert.ok(bad.problems.some((p: { problem: string }) => p.problem.includes('docs/forecast.md')));
    const good = await call(fx, 'check_answer', { answer: 'About 2.1M 429s a month as of September.', citations: [{ ref: 'docs/metrics.md', excerpt: 'September 2.1M' }] });
    assert.equal(good.ok, true, JSON.stringify(good.problems));
    assert.deepEqual(good.evidence, { witnessed: 1, reported: 0, unresolved: 0 });
    assert.deepEqual({ runs: listRuns(fx.broker.store, {}).length, statements: listStatements(fx.broker.store).length }, before);
  } finally {
    fx.cleanup();
  }
});

test('what the host read from a tracker is tracked: citations resolve, quotes are checked, a changed ticket flags the work that cited it', async () => {
  const fx = brokerFixture();
  try {
    const s = fx.broker.store;
    const at = fx.ctx.now();
    addSource(s, { id: 'jira-plat', kind: 'jira', locator: 'PLAT', purpose: 'platform tickets', authorityLevel: 'authoritative', sensitivity: 'internal', canRead: true, canWrite: false, at });
    await assert.rejects(call(fx, 'sources', { action: 'report', id: 'jira-plat' }), /items/);
    const first = await call(fx, 'sources', { action: 'report', id: 'jira-plat', items: [{ ref: 'PLAT-101', title: 'Platform events', updatedAt: '2026-08-21', text: 'v1 launch is gated to the Enterprise plan' }, { ref: 'PLAT-102', title: 'Emit events', text: 'emit job events' }] });
    assert.equal(first.outcome, 'changed');
    const ans = await call(fx, 'check_answer', { answer: 'v1 is Enterprise-only.', citations: [{ ref: 'PLAT-101', excerpt: 'gated to the Enterprise plan' }, { ref: 'PLAT-999' }] });
    assert.deepEqual(ans.evidence, { witnessed: 0, reported: 1, unresolved: 1 }, 'a reported read is the host\'s word, and an item it never reported does not resolve');
    const misquote = await call(fx, 'check_answer', { answer: 'Pro gets it.', citations: [{ ref: 'PLAT-101', excerpt: 'Pro gets webhooks at launch' }] });
    assert.ok(misquote.problems.some((p: { check: string }) => p.check === 'excerpts_match'), 'quotes are checked against what the host reported');

    // Finished work that cited PLAT-101.
    const started = await call(fx, 'start_outcome', { workflowId: 'managed-outcome', input: { request: 'summarize gating' } });
    const runId = started.run.id;
    await submit(fx, await step(fx, runId), { plan: ['read'], assumptions: [], blockers: [] }, []);
    await submit(fx, await step(fx, runId), { summary: 'Enterprise only', findings: ['gated'], changes: [] }, [{ ref: 'PLAT-101' }]);
    await submit(fx, await step(fx, runId), { verification: 'read', passed: true }, [{ ref: 'PLAT-101' }]);
    const done = await submit(fx, await step(fx, runId), { deliverableId: 'gating', summary: 'Enterprise only', findings: ['gated'] }, [{ ref: 'PLAT-101' }]);
    assert.equal(done.run.state, 'succeeded');

    const partial = await call(fx, 'sources', { action: 'report', id: 'jira-plat', partial: true, items: [{ ref: 'PLAT-101', title: 'Platform events', updatedAt: '2026-09-29', text: 'Decision reversed: Pro at launch with caps' }] });
    assert.deepEqual(partial.changes, { added: [], removed: [], modified: ['PLAT-101'] }, 'a partial read never treats unreported items as removed');
    assert.equal(partial.staleDeliverables.length, 1);
    const q = listOpenDecisions(s).find((d) => (d.subject as { deliverableIds?: string[] } | null)?.deliverableIds?.length);
    assert.ok(q, 'the person is asked about the work that cited the changed ticket');
    await assert.rejects(call(fx, 'sources', { action: 'report', id: 'nope', items: [{ ref: 'x' }] }), /no active source/);
  } finally {
    fx.cleanup();
  }
});

test('what the person settled governs: a remembered supersession is enforced, and settled decisions reach every reading step', async () => {
  const fx = brokerFixture();
  try {
    mkdirSync(join(fx.broker.root, 'docs', 'decisions'), { recursive: true });
    writeFileSync(join(fx.broker.root, 'docs', 'decisions', 'adr-004-retry-policy.md'), 'Retry 3 times within 1 hour.\n');
    await call(fx, 'remember', { kind: 'decision', text: 'ADR-004 is superseded by the INT-203 decision: retries back off over 24h.' });
    const silent = await call(fx, 'check_answer', { answer: 'Retries are capped at 3 within an hour.', citations: [{ ref: 'docs/decisions/adr-004-retry-policy.md' }] });
    assert.ok(silent.problems.some((p: { check: string; problem: string }) => p.check === 'superseded_acknowledged' && p.problem.includes('INT-203')));
    const said = await call(fx, 'check_answer', { answer: 'ADR-004 said 3 retries within an hour, but it is superseded by INT-203.', citations: [{ ref: 'docs/decisions/adr-004-retry-policy.md' }] });
    assert.ok(!said.problems.some((p: { check: string }) => p.check === 'superseded_acknowledged'));
    const started = await call(fx, 'start_outcome', { workflowId: 'prd-authoring', input: { request: 'PRD', target: 'docs/prd.md' } });
    const w = await step(fx, started.run.id);
    assert.ok(w.instructions.some((i: string) => i.includes('Settled by the person') && i.includes('INT-203')));
  } finally {
    fx.cleanup();
  }
});

test('answering "revise" on stale work offers a linked revision, and the revision must say what it revises and what changed', async () => {
  const fx = brokerFixture();
  try {
    const s = fx.broker.store;
    const at = fx.ctx.now();
    const dir = join(fx.broker.root, 'notes');
    mkdirSync(dir);
    writeFileSync(join(dir, 'pricing.md'), 'Enterprise only for v1.\n');
    writeFileSync(join(fx.broker.root, 'docs', 'brief.md'), '# Brief\nv1 is Enterprise only.\n');
    addSource(s, { id: 'notes', kind: 'directory', locator: dir, purpose: 'notes', authorityLevel: 'informative', sensitivity: 'internal', canRead: true, canWrite: false, at });
    await call(fx, 'sources', { action: 'refresh', id: 'notes' });
    const started = await call(fx, 'start_outcome', { workflowId: 'managed-outcome', input: { request: 'brief on gating' } });
    const runId = started.run.id;
    await submit(fx, await step(fx, runId), { plan: ['read'], assumptions: [], blockers: [] }, []);
    await submit(fx, await step(fx, runId), { summary: 'Enterprise only', findings: ['gated'], changes: ['docs/brief.md'] }, [{ ref: 'notes/pricing.md' }]);
    await submit(fx, await step(fx, runId), { verification: 'read', passed: true }, [{ ref: 'docs/brief.md' }]);
    const done = await submit(fx, await step(fx, runId), { deliverableId: 'brief', artifact: 'docs/brief.md', summary: 'Enterprise only', findings: ['gated'] }, [{ ref: 'notes/pricing.md' }]);
    const deliverableId = done.deliverable.id;

    writeFileSync(join(dir, 'pricing.md'), 'Pro at launch, capped at 5 subscriptions.\n');
    await call(fx, 'sources', { action: 'refresh', id: 'notes' });
    const q = listOpenDecisions(s).find((d) => (d.subject as { deliverableIds?: string[] } | null)?.deliverableIds?.includes(deliverableId))!;
    const answered = await call(fx, 'decide', { decisionId: q.id, resolution: 'revise' });
    const offer = answered.suggestedOutcomes[0];
    assert.equal(offer.workflowId, 'revise-deliverable');
    assert.equal(offer.input.deliverable, deliverableId);
    assert.equal(offer.input.target, 'docs/brief.md');
    assert.equal(listRuns(s, {}).filter((r) => r.workflowId === 'revise-deliverable').length, 0, 'nothing starts until the person wants it');

    const rev = await call(fx, 'start_outcome', { workflowId: 'revise-deliverable', input: offer.input });
    const revRun = rev.run.id;
    await submit(fx, await step(fx, revRun), { summary: 'pricing changed', findings: ['Pro at launch'], conflicts: [], unknowns: [] }, [{ ref: 'notes/pricing.md', excerpt: 'Pro at launch' }, { ref: `deliverable:${deliverableId}` }]);
    writeFileSync(join(fx.broker.root, 'docs', 'brief.md'), '# Brief\nPro gets webhooks at launch, capped at 5 subscriptions.\n');
    const unlinked = await submit(fx, await step(fx, revRun), { summary: 'revised', findings: ['Pro at launch'], artifact: 'docs/brief.md', derivations: [] }, [{ ref: 'notes/pricing.md' }]);
    assert.ok(unlinked.validation.some((v: { validator: string; ok: boolean }) => v.validator === 'revision_linked' && !v.ok));
    const linked = await submit(fx, await step(fx, revRun), { summary: 'revised', findings: ['Pro at launch'], artifact: 'docs/brief.md', revises: deliverableId, changeSummary: 'Enterprise-only gating replaced by Pro at launch with a 5-subscription cap, per notes/pricing.md', derivations: [] }, [{ ref: 'notes/pricing.md' }]);
    assert.equal(linked.step.state, 'succeeded', JSON.stringify(linked.validation));
  } finally {
    fx.cleanup();
  }
});
