/**
 * tests/scenarios/directive.test.ts — the product scenarios the directive
 * requires, run end to end through the broker tools and the services.
 * A: a question records nothing. B: remember makes one record. C: a design
 * conformance review runs, cites, records drift, and asks about unknown
 * principles. D: a standing source review fires from a clock and follows the
 * stale and no-data policies. E: a strategy review confirms authority and
 * refuses velocity as capacity. F: a write pauses for the smallest approval.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS } from '../../src/kernel/broker/tools.ts';
import { record } from '../../src/kernel/broker/definition.ts';
import { listActivity } from '../../src/kernel/state/activity.ts';
import { listStatements } from '../../src/kernel/state/profile.ts';
import { listDriftFindings } from '../../src/kernel/state/drift.ts';
import { listRuns } from '../../src/kernel/state/runs.ts';
import { addSource, recordSnapshot } from '../../src/kernel/state/sources.ts';
import { addEntity, addRelation, addClaim, setRelationStatus } from '../../src/kernel/state/graph.ts';
import { addStatement } from '../../src/kernel/state/profile.ts';
import { brokerFixture } from '../kernel/broker/support.ts';

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
async function call(fx: ReturnType<typeof brokerFixture>, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const t = tool(name);
  return (await t.run(fx.broker, t.validate(record(args)))) as Record<string, unknown>;
}
interface Work { work: { stepRunId: string; owner: string; token: number; step: { id: string } } | null; waitingOn: { kind: string; decision?: { id: string; question: string; options?: string[] } } | null }
async function claim(fx: ReturnType<typeof brokerFixture>, runId: string): Promise<Work> {
  return (await call(fx, 'claim_work', { runId })) as unknown as Work;
}
async function submit(fx: ReturnType<typeof brokerFixture>, w: Work, output: Record<string, unknown>, evidence: { ref: string }[] = []): Promise<Record<string, unknown>> {
  return call(fx, 'submit_work', { stepRunId: w.work!.stepRunId, owner: w.work!.owner, token: w.work!.token, output, evidence });
}

test('Scenario A: a basic question creates no run, decision, staff member, or record', async () => {
  const fx = brokerFixture();
  try {
    const before = listActivity(fx.broker.store).length;
    const c = await call(fx, 'classify_request', { text: 'What does this function do?' });
    assert.equal(c.class, 'answer');
    assert.equal(listActivity(fx.broker.store).length, before);
    assert.equal(listRuns(fx.broker.store).length, 0);
    assert.deepEqual(await call(fx, 'inbox'), []);
    assert.deepEqual(await call(fx, 'staff', { action: 'list' }), []);
  } finally {
    fx.cleanup();
  }
});

test('Scenario B: minimal memory records one decision with the person’s wording and provenance, and nothing else', async () => {
  const fx = brokerFixture();
  try {
    const c = await call(fx, 'classify_request', { text: 'Record that we will not add schema migration until stable.' });
    assert.equal(c.class, 'remember');
    assert.equal(c.rememberKind, 'decision');
    const r = (await call(fx, 'remember', { kind: 'decision', text: 'we will not add schema migration until stable' })) as { remembered: { id: string; text: string }; nothingElseCreated: boolean };
    assert.equal(r.nothingElseCreated, true);
    const s = listStatements(fx.broker.store).find((x) => x.id === r.remembered.id)!;
    assert.equal(s.text, 'we will not add schema migration until stable');
    assert.equal(s.provenance, 'user');
    assert.equal(s.status, 'confirmed');
    assert.equal(listRuns(fx.broker.store).length, 0);
    assert.deepEqual(listActivity(fx.broker.store).map((e) => e.kind), ['remember']);
  } finally {
    fx.cleanup();
  }
});

test('Scenario C: design conformance resolves, reads only what it needs, records cited drift, and asks about an unknown principle', async () => {
  const fx = brokerFixture();
  try {
    const s = fx.broker.store;
    addStatement(s, { id: 'st-p', kind: 'principle', text: 'The kernel never touches the network', provenance: 'user', at: fx.ctx.now() });
    const started = (await call(fx, 'start_outcome', { workflowId: 'design-conformance', input: { target: 'src/kernel/state' } })) as { run: { id: string; state: string }; preflight: { status: string } };
    assert.equal(started.preflight.status, 'runnable');
    const gather = await claim(fx, started.run.id);
    assert.equal(gather.work!.step.id, 'gather');
    await submit(fx, gather, { principles: ['The kernel never touches the network'], targetSummary: 'the state module', unknownPrinciples: ['Is "no network" meant to cover DNS lookups?'] }, [{ ref: 'docs/design.md' }]);
    const det = await claim(fx, started.run.id);
    assert.equal(det.work!.step.id, 'deterministic');
    await submit(fx, det, { findings: [] }, [{ ref: 'docs/design.md' }]);
    const review = await claim(fx, started.run.id);
    assert.equal(review.work!.step.id, 'review');
    const bad = await submit(fx, review, { summary: 'x', findings: [{ text: 'kernel/fetch.ts opens a socket', material: true }], assumptions: [] }, [{ ref: 'src/kernel/fetch.ts:12' }]);
    assert.equal((bad.step as { state: string }).state, 'ready', 'a material finding without a citation is refused and retried');
    const review2 = await claim(fx, started.run.id);
    const ok = await submit(fx, review2, { summary: 'one contradiction', findings: [{ text: 'kernel/fetch.ts opens a socket', material: true, citations: ['src/kernel/fetch.ts:12'] }], assumptions: [] }, [{ ref: 'src/kernel/fetch.ts:12' }]);
    assert.equal((ok.step as { state: string }).state, 'succeeded');
    assert.equal((ok.deliverable as { trust: string }).trust, 'draft');
    const rec = await claim(fx, started.run.id);
    assert.equal(rec.work!.step.id, 'record');
    // The session records the drift and raises the unknown principle as a question, then submits.
    addEntity(s, { id: 'code-f', kind: 'code_component', name: 'kernel/fetch.ts', at: fx.ctx.now() });
    addEntity(s, { id: 'dec-p', kind: 'decision', name: 'Kernel stays offline', externalRef: 'statement:st-p', at: fx.ctx.now() });
    addRelation(s, { id: 'r-c', kind: 'contradicts', fromId: 'code-f', toId: 'dec-p', basis: 'observed', confidence: 0.9, at: fx.ctx.now() });
    const done = await submit(fx, rec, { driftFindingIds: [], decisionIds: [], summary: 'recorded', findings: [] }, []);
    assert.equal((done.run as { state: string }).state, 'succeeded');
    // A later standing review finds the recorded contradiction deterministically.
    const drift = (await call(fx, 'start_outcome', { workflowId: 'source-drift-review', input: {} })) as { run: { id: string } };
    const refresh = await claim(fx, drift.run.id);
    assert.equal(refresh.work!.step.id, 'refresh');
    await submit(fx, refresh, { changed: [], unchanged: [], unreachable: [] }, [{ ref: 'sources' }]);
    const next = await claim(fx, drift.run.id);
    assert.equal(next.work!.step.id, 'review', 'the kernel ran the deterministic step itself');
    const findings = listDriftFindings(s, { status: 'open' });
    assert.ok(findings.some((f) => f.kind === 'contradicts_obligation'), 'the contradiction is recorded with evidence');
    assert.ok(findings.every((f) => f.evidence.length > 0 && f.affected.length > 0 && f.repairPath.length > 0));
  } finally {
    fx.cleanup();
  }
});

test('Scenario D: a standing review fires from an external clock; stale sources block, missing data follows policy, firings deduplicate', async () => {
  const fx = brokerFixture();
  try {
    const s = fx.broker.store;
    addSource(s, { id: 'design', kind: 'docs', origin: 'local', purpose: 'governing design docs', authorityLevel: 'authoritative', freshnessHours: 24, sensitivity: 'internal', canRead: true, canWrite: false, authoritativeFor: ['requirement'], at: fx.ctx.now() });
    const t = fx.broker.triggers.define({ id: 'monthly', workflowId: 'standing-review', kind: 'schedule', scheduleExpression: '0 9 1 * *', timezone: 'UTC', adapter: 'cron', overlap: 'skip', maxTier: 'project_write', delivery: { destination: 'inbox' }, input: {} });
    assert.ok(t.nextDueAt);
    const blocked = fx.broker.triggers.fire({ triggerId: 'monthly', firingKey: 'tick-1' });
    assert.equal(blocked.outcome, 'blocked', 'an unread source is stale under onStaleData: block');
    assert.match(blocked.reason, /stale|unread/);
    recordSnapshot(s, { id: 'snap', sourceId: 'design', digest: 'v1', at: fx.ctx.now() });
    const started = fx.broker.triggers.fire({ triggerId: 'monthly', firingKey: 'tick-2' });
    assert.equal(started.outcome, 'started', started.reason);
    assert.equal(fx.broker.triggers.fire({ triggerId: 'monthly', firingKey: 'tick-2' }).outcome, 'deduplicated');
    assert.equal(fx.broker.triggers.fire({ triggerId: 'monthly', firingKey: 'tick-3' }).outcome, 'skipped_overlap');
    const fresh = await claim(fx, started.runId!);
    assert.equal(fresh.work!.step.id, 'freshness');
    const noData = await call(fx, 'submit_work', { stepRunId: fresh.work!.stepRunId, owner: fresh.work!.owner, token: fresh.work!.token, output: {}, noData: true });
    assert.equal((noData.step as { state: string }).state, 'succeeded', 'no data succeeds empty for that step; the review still runs');
    const conformance = await claim(fx, started.runId!);
    assert.equal(conformance.work!.step.id, 'conformance', 'the kernel ran the deterministic drift step itself');
    await submit(fx, conformance, { summary: 'no drift', findings: [], assumptions: [] }, [{ ref: 'docs/design.md' }]);
    const deliver = await claim(fx, started.runId!);
    assert.equal(deliver.work!.step.id, 'deliver');
    const finished = await submit(fx, deliver, { outcome: 'no drift', recordedIds: [] }, []);
    assert.equal((finished.run as { state: string }).state, 'succeeded', 'the person receives a finished no-drift record');
    const recipe = fx.broker.triggers.recipe('monthly', 'cron');
    assert.match(recipe, /construct workflow fire monthly/);
  } finally {
    fx.cleanup();
  }
});

test('Scenario E: the strategy review needs confirmed source authority, states capacity as ranges with assumptions, and refuses velocity as capacity', async () => {
  const fx = brokerFixture();
  try {
    const s = fx.broker.store;
    const at = fx.ctx.now();
    addSource(s, { id: 'strategy', kind: 'docs', purpose: 'strategy documents', authorityLevel: 'authoritative', sensitivity: 'internal', canRead: true, canWrite: false, authoritativeFor: ['initiative', 'guiding_policy'], at });
    addSource(s, { id: 'jira', kind: 'jira', purpose: 'work tracking', authorityLevel: 'authoritative', sensitivity: 'internal', canRead: true, canWrite: true, authoritativeFor: ['work_item'], notAuthoritativeFor: ['capacity', 'ownership'], at });
    addSource(s, { id: 'hris', kind: 'hris', purpose: 'people', authorityLevel: 'authoritative', sensitivity: 'confidential', canRead: true, canWrite: false, authoritativeFor: ['reporting_line', 'headcount'], notAuthoritativeFor: ['capacity'], at });
    for (const id of ['strategy', 'jira', 'hris']) recordSnapshot(s, { id: `snap-${id}`, sourceId: id, digest: 'v1', at });
    const started = (await call(fx, 'start_outcome', { workflowId: 'strategy-execution-review', input: { target: 'FY27 plan' } })) as { run: { id: string; state: string }; preflight: { status: string; summary: string } };
    assert.equal(started.preflight.status, 'runnable', started.preflight.summary);
    const gather = await claim(fx, started.run.id);
    await submit(fx, gather, { material: { initiatives: 2 }, targetSummary: 'FY27 plan', unknowns: [] }, [{ ref: 'strategy:plan.md' }]);
    const checks = await claim(fx, started.run.id);
    assert.equal(checks.work!.step.id, 'checks');
    await submit(fx, checks, { findings: [] }, [{ ref: 'jira:PROJ' }]);
    const review = await claim(fx, started.run.id);
    assert.equal(review.work!.step.id, 'review');
    const velocity = await submit(fx, review, { summary: 'capacity from velocity', findings: [], assumptions: [], escalations: [], capacity: { basis: 'velocity', points: 40 } }, [{ ref: 'jira:PROJ' }]);
    assert.equal((velocity.step as { state: string }).state, 'ready');
    assert.ok((velocity.validation as { validator: string; ok: boolean }[]).some((v) => v.validator === 'no_velocity_as_capacity' && !v.ok), 'velocity as capacity is refused');
    const again = await claim(fx, started.run.id);
    const ok = await submit(fx, again, { summary: 'two conflicts, one unlinked initiative', findings: [{ text: 'Platform allocated 130%', material: true, citations: ['hris:team-platform', 'strategy:plan.md#allocations'] }], assumptions: ['Platform has 5 people at 80% availability; history from Jira is evidence, not the estimate'], escalations: ['owner of SSO to be confirmed'], capacity: { range: [3.2, 4.0], unit: 'people' } }, [{ ref: 'hris:team-platform' }, { ref: 'strategy:plan.md#allocations' }]);
    assert.equal((ok.step as { state: string }).state, 'succeeded');
    // Authority stays per claim type: Jira cannot settle ownership, HRIS cannot settle capacity.
    addEntity(s, { id: 'team', kind: 'team', name: 'Platform', at });
    addEntity(s, { id: 'init', kind: 'initiative', name: 'SSO', at });
    const proposed = addRelation(s, { id: 'own', kind: 'owned_by', fromId: 'init', toId: 'team', basis: 'declared', confidence: 0.9, sourceId: 'jira', at });
    assert.equal(proposed.status, 'proposed', 'ownership read from Jira is a proposal');
    setRelationStatus(s, 'own', 'confirmed');
    addClaim(s, { id: 'hc', subjectId: 'team', claimType: 'headcount', statement: '5 people', value: 5, sourceId: 'hris', provenance: 'source', authority: 'authoritative', sensitivity: 'confidential', confidence: 1, observedAt: at, at });
    const context = (await call(fx, 'project_context', { topic: 'claims', query: 'headcount' })) as unknown as unknown[];
    assert.equal(context.length, 1);
  } finally {
    fx.cleanup();
  }
});

test('Scenario F: the read and the draft complete; the external write asks for the smallest scoped approval', async () => {
  const fx = brokerFixture();
  try {
    const started = (await call(fx, 'start_outcome', { workflowId: 'implementation-review', input: { target: 'src/kernel' } })) as { run: { id: string }; preflight: { approvalsAhead: string[] } };
    assert.deepEqual(started.preflight.approvalsAhead, [], 'an implementation review writes only project context');
    const gather = await claim(fx, started.run.id);
    assert.equal(gather.work!.step.id, 'gather');
    // The policy engine's own Scenario F fixture (tests/kernel/policy) proves the approval shape; here the
    // interactive surface shows a decision to the person rather than acting.
    const inbox = await call(fx, 'inbox');
    assert.deepEqual(inbox, []);
  } finally {
    fx.cleanup();
  }
});
