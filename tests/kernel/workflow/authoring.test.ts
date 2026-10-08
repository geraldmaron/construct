/**
 * tests/kernel/workflow/authoring.test.ts — writing a PRD, RFC, or proposal
 * is a routed, gated outcome: the request finds the workflow and its inputs,
 * a draft that skips a template section or invents a figure is sent back,
 * and only an artifact that exists and holds up is handed over.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { record } from '../../../src/kernel/broker/definition.ts';
import { brokerFixture } from '../broker/support.ts';

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
async function call(fx: ReturnType<typeof brokerFixture>, name: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const t = tool(name);
  return (await t.run(fx.broker, t.validate(record(args)))) as Record<string, any>;
}

test('artifact requests route to the authoring workflows, with their inputs, without a failed start', async () => {
  const fx = brokerFixture();
  try {
    const cases: [string, string, string][] = [
      ['Write a PRD for public webhooks using our PRD template.', 'requirements-structuring', 'prd-authoring'],
      ['Draft an RFC for webhook event delivery, building on RFC-012.', 'system-architecture', 'rfc-authoring'],
      ['Write a one-page proposal for Sam to fully fund webhooks this half.', 'decision-framing', 'proposal-authoring'],
    ];
    for (const [text, skill, workflow] of cases) {
      const c = await call(fx, 'classify_request', { text });
      assert.equal(c.class, 'manage', text);
      assert.ok(c.skills.slice(0, 3).some((s: { id: string }) => s.id === skill), `${text} -> ${c.skills.map((s: { id: string }) => s.id).join(',')}`);
      const suggested = c.suggestedWorkflows.find((w: { id: string }) => w.id === workflow);
      assert.ok(suggested, `${workflow} is suggested for: ${text}`);
      assert.ok(suggested.required.includes('target'));
    }
  } finally {
    fx.cleanup();
  }
});

test('a PRD run sends back a draft that skips a template section or invents a figure, and hands over one that holds up', async () => {
  const fx = brokerFixture();
  try {
    const root = fx.broker.root;
    mkdirSync(join(root, 'docs', 'templates'), { recursive: true });
    writeFileSync(join(root, 'docs', 'templates', 'prd.md'), '# PRD: <title>\n## 1. Problem\n## 2. Evidence\n## 3. Open questions\n');
    writeFileSync(join(root, 'docs', 'metrics.md'), '429 responses per month: June 1.6M, September 2.1M.\n');
    writeFileSync(join(root, 'docs', 'okrs.md'), 'KR2: reduce API 429 responses by 50% vs the June baseline.\n');
    const started = await call(fx, 'start_outcome', { workflowId: 'prd-authoring', input: { request: 'PRD for webhooks', target: 'docs/prd-webhooks.md', template: 'docs/templates/prd.md' } });
    assert.equal(started.preflight.status, 'runnable', started.preflight.summary);
    const runId = started.run.id as string;
    const step = async () => (await call(fx, 'claim_work', { runId })).work;
    const submit = (w: any, output: Record<string, unknown>, evidence: { ref: string; excerpt?: string }[]) =>
      call(fx, 'submit_work', { stepRunId: w.stepRunId, owner: w.owner, token: w.token, output, evidence });

    let w = await step();
    assert.equal(w.step.id, 'gather');
    assert.ok(w.instructions.some((i: string) => i.includes('conflicts_declared needs')), 'the host is told what each check needs');
    const gathered = await submit(w, { summary: 'polling hurts', findings: ['429s rose'], material: ['metrics', 'okrs'], conflicts: [], unknowns: ['polling baseline'] }, [{ ref: 'docs/metrics.md', excerpt: 'September 2.1M' }, { ref: 'docs/okrs.md' }]);
    assert.equal(gathered.step.state, 'succeeded', JSON.stringify(gathered.validation));

    const prd = join(root, 'docs', 'prd-webhooks.md');
    writeFileSync(prd, '# PRD: Webhooks\n## Problem\n429s reached 2.1M and cost us $3.2M.\n## Evidence\nsee metrics\n');
    w = await step();
    assert.equal(w.step.id, 'draft');
    const bad = await submit(w, { summary: 'draft', findings: ['429s rose'], artifact: 'docs/prd-webhooks.md', derivations: [] }, [{ ref: 'docs/metrics.md' }]);
    assert.notEqual(bad.step.state, 'succeeded');
    const problems = bad.validation.flatMap((v: { problems: string[] }) => v.problems).join(' | ');
    assert.match(problems, /3\.2m/);
    assert.match(problems, /open questions/);

    writeFileSync(prd, '# PRD: Webhooks\n## Problem\n429s reached 2.1M a month; the target is 0.8M.\n## Evidence\nmetrics and KR2\n## Open questions\nNo polling baseline yet.\n');
    w = await step();
    const good = await submit(w, { summary: 'draft', findings: ['429s rose'], artifact: 'docs/prd-webhooks.md', derivations: [{ value: '0.8M', expression: '1.6M * 50%' }] }, [{ ref: 'docs/metrics.md' }, { ref: 'docs/okrs.md', excerpt: 'reduce API 429 responses by 50%' }]);
    assert.equal(good.step.state, 'succeeded', JSON.stringify(good.validation));

    w = await step();
    assert.equal(w.step.id, 'challenge');
    const challenged = await submit(w, { verdict: 'holds', summary: 'no unsupported claims', findings: [] }, [{ ref: 'docs/prd-webhooks.md' }]);
    assert.equal(challenged.deliverable.trust, 'draft');
    w = await step();
    const done = await submit(w, { artifact: 'docs/prd-webhooks.md', verdict: 'holds' }, [{ ref: 'docs/prd-webhooks.md' }]);
    assert.equal(done.run.state, 'succeeded');
    assert.equal(done.deliverable.trust, 'validated');
    const status = await call(fx, 'run_status', { runId });
    const final = status.deliverables.at(-1);
    assert.deepEqual(final.verification.evidence, { witnessed: 3, reported: 0, unverified: 0, unresolved: 0 }, 'the deliverable records what the whole run rested on');
  } finally {
    fx.cleanup();
  }
});

test('when checks keep failing the person decides: the work is kept, an accepted waiver is recorded, and the result is never called validated', async () => {
  const fx = brokerFixture();
  try {
    const root = fx.broker.root;
    writeFileSync(join(root, 'docs', 'notes.md'), 'Customers poll the jobs API.\n');
    writeFileSync(join(root, 'docs', 'prd.md'), '# PRD\n## Problem\nPolling costs $9.9M a year.\n');
    const started = await call(fx, 'start_outcome', { workflowId: 'prd-authoring', input: { request: 'PRD', target: 'docs/prd.md' } });
    const runId = started.run.id as string;
    const step = async () => (await call(fx, 'claim_work', { runId })).work;
    const submit = (w: any, output: Record<string, unknown>, evidence: { ref: string }[]) => call(fx, 'submit_work', { stepRunId: w.stepRunId, owner: w.owner, token: w.token, output, evidence });
    await submit(await step(), { summary: 's', findings: ['f'], material: [], conflicts: [], unknowns: [] }, [{ ref: 'docs/notes.md' }]);
    const draft = { summary: 'draft', findings: ['cost'], artifact: 'docs/prd.md', derivations: [] };
    let r: Record<string, any> = {};
    for (let i = 0; i < 3; i++) r = await submit(await step(), draft, [{ ref: 'docs/notes.md' }]);
    assert.equal(r.step.state, 'waiting_for_decision', 'the run is not thrown away when retries run out');
    assert.equal(r.run.state, 'waiting_for_decision');
    const inbox = (await call(fx, 'inbox')) as unknown as { id: string; question: string; options: string[] }[];
    const q = inbox.find((d) => d.question.includes('still fails'))!;
    assert.match(q.question, /9\.9m/);
    assert.deepEqual(q.options, ['accept with these problems', 'another attempt', 'stop']);
    await call(fx, 'decide', { decisionId: q.id, resolution: 'accept with these problems' });
    const w = await step();
    assert.ok(w.instructions.some((i: string) => i.includes('accepted this step despite')));
    const accepted = await submit(w, draft, [{ ref: 'docs/notes.md' }]);
    assert.equal(accepted.step.state, 'succeeded');
    await submit(await step(), { verdict: 'figure unsupported, accepted by person', summary: 'c', findings: [] }, [{ ref: 'docs/prd.md' }]);
    const done = await submit(await step(), { artifact: 'docs/prd.md', verdict: 'waived' }, [{ ref: 'docs/prd.md' }]);
    assert.equal(done.run.state, 'succeeded');
    assert.notEqual(done.deliverable?.trust, 'validated', 'a waived check never reads as a passed one');
  } finally {
    fx.cleanup();
  }
});
