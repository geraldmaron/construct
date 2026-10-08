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
    assert.deepEqual(good.evidence, { witnessed: 1, reported: 0, unverified: 0, unresolved: 0 });
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
    assert.deepEqual(ans.evidence, { witnessed: 0, reported: 1, unverified: 0, unresolved: 1 }, 'a reported read is the host\'s word, and an item it never reported does not resolve');
    const misquote = await call(fx, 'check_answer', { answer: 'Pro gets it.', citations: [{ ref: 'PLAT-101', excerpt: 'Pro gets webhooks at launch' }] });
    assert.ok(misquote.problems.some((p: { check: string }) => p.check === 'excerpts_match'), 'quotes are checked against what the host reported');

    // Finished work that cited PLAT-101.
    const started = await call(fx, 'start_outcome', { workflowId: 'managed-outcome', input: { request: 'summarize gating' } });
    const runId = started.run.id;
    await submit(fx, await step(fx, runId), { plan: ['read'], assumptions: [], blockers: [] }, []);
    await submit(fx, await step(fx, runId), { summary: 'Enterprise only', findings: ['gated'], changes: [], artifact: null }, [{ ref: 'PLAT-101' }]);
    const done = await submit(fx, await step(fx, runId), { verification: 'read', passed: true }, [{ ref: 'PLAT-101' }]);
    assert.equal(done.run.state, 'succeeded');

    const partial = await call(fx, 'sources', { action: 'report', id: 'jira-plat', partial: true, items: [{ ref: 'PLAT-101', title: 'Platform events', updatedAt: '2026-09-29', text: 'Decision reversed: Pro at launch with caps' }] });
    assert.deepEqual(partial.changes, { added: [], removed: [], modified: ['PLAT-101'] }, 'a partial read never treats unreported items as removed');
    assert.equal(partial.staleDeliverables.length, 1);
    const q = listOpenDecisions(s).find((d) => (d.subject as { deliverableIds?: string[] } | null)?.deliverableIds?.length);
    assert.ok(q, 'the person is asked about the work that cited the changed ticket');
    await assert.rejects(call(fx, 'sources', { action: 'report', id: 'nope', items: [{ ref: 'x' }] }), /no source "nope" is declared; declare it with sources action declare/);
  } finally {
    fx.cleanup();
  }
});

test('an answer resting on citations admitted on the host\'s word is told to name them as unverified', async () => {
  const fx = brokerFixture();
  try {
    const at = fx.ctx.now();
    addSource(fx.broker.store, { id: 'jira-plat', kind: 'jira', locator: 'PLAT', purpose: 'platform tickets', authorityLevel: 'authoritative', sensitivity: 'internal', canRead: true, canWrite: false, at });
    await call(fx, 'sources', { action: 'report', id: 'jira-plat', partial: true, items: [{ ref: 'PLAT-101', text: 'v1 launch is gated to the Enterprise plan' }] });
    const strict = await call(fx, 'check_answer', { answer: 'v1 is Enterprise-only.', citations: [{ ref: 'PLAT-101' }, { ref: 'jira-plat:PLAT-999' }] });
    assert.equal(strict.ok, false, 'under require an unrecorded ticket names nothing');
    assert.doesNotMatch(strict.next, /unverified/);
    const accepting = { ...fx.broker, policy: { hostReads: 'accept' as const, answerCheck: 'nudge' as const } };
    const t = tool('check_answer');
    const loose = await t.run(accepting, t.validate(record({ answer: 'v1 is Enterprise-only.', citations: [{ ref: 'PLAT-101' }, { ref: 'jira-plat:PLAT-999' }, { ref: 'https://example.com/blog' }] }))) as any;
    assert.equal(loose.ok, true, JSON.stringify(loose.problems));
    assert.deepEqual(loose.evidence, { witnessed: 0, reported: 1, unverified: 2, unresolved: 0 });
    assert.match(loose.next, /no recorded read holds jira-plat:PLAT-999, https:\/\/example\.com\/blog/);
    assert.match(loose.next, /unverified/);
  } finally {
    fx.cleanup();
  }
});

test('an answer about a period is checked against it: a cited item updated after the period is flagged unless the answer says why it belongs', async () => {
  const fx = brokerFixture();
  try {
    const at = fx.ctx.now();
    addSource(fx.broker.store, { id: 'jira-plat', kind: 'jira', locator: 'PLAT', purpose: 'platform tickets', authorityLevel: 'authoritative', sensitivity: 'internal', canRead: true, canWrite: false, at });
    await call(fx, 'sources', { action: 'report', id: 'jira-plat', items: [
      { ref: 'PLAT-201', updatedAt: '2026-05-20T10:00:00Z', text: 'Retries capped at five' },
      { ref: 'PLAT-202', updatedAt: '2026-07-03T09:00:00Z', text: 'Retries capped at three' },
    ] });
    const lastQuarter = { semantics: 'changed_during', relative: 'last_quarter' };
    const before = listRuns(fx.broker.store, {}).length;
    const late = await call(fx, 'check_answer', { answer: 'Last quarter retries were capped.', citations: [{ ref: 'PLAT-201' }, { ref: 'PLAT-202' }], period: lastQuarter });
    assert.equal(late.ok, false);
    assert.deepEqual(late.problems, [{ check: 'within_period', problem: '"PLAT-202" was updated 2026-07-03, after the period ends (2026-06-30); cite a version from inside the period, or list it under "outsidePeriod" with why it belongs' }]);
    assert.deepEqual([late.period.from, late.period.to, late.period.timezone], ['2026-04-01', '2026-06-30', 'UTC']);
    assert.ok(late.period.assumptions.includes('quarters are calendar quarters'));
    const said = await call(fx, 'check_answer', { answer: 'Last quarter retries were capped at five; PLAT-202 changed that after the quarter closed.', citations: [{ ref: 'PLAT-201' }, { ref: 'PLAT-202' }], period: lastQuarter, outsidePeriod: [{ ref: 'PLAT-202', why: 'it records the change that followed' }] });
    assert.equal(said.ok, true, JSON.stringify(said.problems));
    const timeless = await call(fx, 'check_answer', { answer: 'Retries are capped.', citations: [{ ref: 'PLAT-202' }] });
    assert.equal(timeless.ok, true, 'an answer that names no period is not checked against one');
    assert.equal(timeless.period, undefined);
    await assert.rejects(call(fx, 'check_answer', { answer: 'Q3 retries.', citations: [], period: { semantics: 'changed_during', relative: 'last_quarter', from: '2026-07-01', to: '2026-09-30' } }), (e: { name: string; field: string; message: string }) =>
      e.name === 'ToolInputError' && e.field === 'period' && /runs from 2026-04-01 to 2026-06-30/.test(e.message) && /Pass period as/.test(e.message));
    await assert.rejects(call(fx, 'check_answer', { answer: 'Q3 retries.', period: 'Q3' }), /"period" must be an object/);
    assert.equal(listRuns(fx.broker.store, {}).length, before, 'checking an answer starts nothing');
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
    await submit(fx, await step(fx, runId), { summary: 'Enterprise only', findings: ['gated'], changes: ['docs/brief.md'], artifact: 'docs/brief.md' }, [{ ref: 'notes/pricing.md' }]);
    const done = await submit(fx, await step(fx, runId), { verification: 'read', passed: true }, [{ ref: 'docs/brief.md' }]);
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

test('the general carrier takes an honest code edit and an analysis that writes nothing, and its deliverable carries what the work did', async () => {
  const fx = brokerFixture();
  try {
    const finish = async (request: string, output: Record<string, unknown>, evidence: { ref: string; excerpt?: string }[]) => {
      const started = await call(fx, 'start_outcome', { workflowId: 'managed-outcome', input: { request } });
      const runId = started.run.id;
      await submit(fx, await step(fx, runId), { plan: ['read', 'change'], assumptions: [], blockers: [] }, []);
      const did = await submit(fx, await step(fx, runId), output, evidence);
      if (did.step.state !== 'succeeded') return { did, done: null, body: null };
      const done = await submit(fx, await step(fx, runId), { verification: { command: 'npm test', exitStatus: 0 }, passed: true }, []);
      const status = await call(fx, 'run_status', { runId });
      return { did, done, body: status.deliverables.at(-1).body };
    };
    // The edited file holds a port and a timeout; they are the change itself, not claims about what was read.
    writeFileSync(join(fx.broker.root, 'src', 'kernel', 'fetch.ts'), "import { connect } from 'node:net';\nexport const open = () => connect(443, 'example.com', { timeout: 15000 });\n");
    const edit = await finish('use TLS for the example connection', { summary: 'the connection uses TLS', findings: ['open() now connects over TLS'], changes: ['src/kernel/fetch.ts'], artifact: null }, [{ ref: 'docs/design.md' }]);
    assert.equal(edit.did.step.state, 'succeeded', JSON.stringify(edit.did.validation));
    assert.equal(edit.done.deliverable.trust, 'validated');
    assert.deepEqual([edit.body.summary, edit.body.changes, edit.body.artifact], ['the connection uses TLS', ['src/kernel/fetch.ts'], null]);
    const named = await finish('use TLS for the example connection', { summary: 'the connection uses TLS', findings: ['open() now connects over TLS'], changes: ['src/kernel/fetch.ts'], artifact: 'src/kernel/fetch.ts' }, [{ ref: 'docs/design.md' }]);
    assert.equal(named.did.step.state, 'succeeded', `code named as the artifact is not read for figures: ${JSON.stringify(named.did.validation)}`);
    const stated = await finish('use TLS for the example connection', { summary: 'the connection uses TLS on port 443', findings: ['open() now connects on port 443 with a 15000 ms timeout'], changes: ['src/kernel/fetch.ts'], artifact: null }, [{ ref: 'src/kernel/fetch.ts' }]);
    assert.equal(stated.did.step.state, 'succeeded', `citing the changed code grounds the values it now holds: ${JSON.stringify(stated.did.validation)}`);

    const analysis = await finish('explain the design principles', { summary: 'one principle', findings: ['the kernel stays host-agnostic'], changes: [], artifact: null }, [{ ref: 'docs/design.md', excerpt: 'Keep the kernel host-agnostic' }]);
    assert.equal(analysis.did.step.state, 'succeeded', JSON.stringify(analysis.did.validation));
    assert.deepEqual([analysis.body.findings, analysis.body.changes, analysis.body.artifact], [['the kernel stays host-agnostic'], [], null]);

    const invented = await finish('how fast is the connection', { summary: 'fast', findings: ['the connection takes p99 420ms'], changes: [], artifact: null }, [{ ref: 'docs/design.md' }]);
    assert.notEqual(invented.did.step.state, 'succeeded');
    assert.ok(invented.did.validation.some((v: { validator: string; ok: boolean; problems: string[] }) => v.validator === 'numbers_grounded' && !v.ok && v.problems.some((p) => p.includes('"420ms"'))));
  } finally {
    fx.cleanup();
  }
});
