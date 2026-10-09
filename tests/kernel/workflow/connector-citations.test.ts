/**
 * tests/kernel/workflow/connector-citations.test.ts — work built only from
 * what the host read through its connectors holds up when those reads were
 * recorded, and an invented ticket is refused with the way to fix it.
 *
 * The systems are declared and reported from the session, the way a host
 * with no hooks does it: a Jira ticket, a Confluence page, and a GitHub pull
 * request, each with its url and the passage relied on. An RFC draft citing
 * only those items, by key, by url, and as owner/repo#N, passes the draft
 * floor, and the run records that its evidence was reported, not witnessed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { record } from '../../../src/kernel/broker/definition.ts';
import { brokerFixture } from '../broker/support.ts';

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
async function call(fx: ReturnType<typeof brokerFixture>, name: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const t = tool(name);
  return (await t.run(fx.broker, t.validate(record(args)))) as Record<string, any>;
}

const PAGE = 'https://acme.atlassian.net/wiki/spaces/ENG/pages/98765/Checkout+retries';

test('an RFC built from recorded connector reads passes the draft floor, and an invented ticket is refused with the remedy', async () => {
  const fx = brokerFixture();
  try {
    await call(fx, 'sources', { action: 'declare', id: 'jira', kind: 'jira', locator: 'PAY' });
    await call(fx, 'sources', { action: 'declare', id: 'confluence', kind: 'docs' });
    await call(fx, 'sources', { action: 'declare', id: 'github', kind: 'github', locator: 'acme/checkout' });
    await call(fx, 'sources', { action: 'report', id: 'jira', partial: true, items: [{ ref: 'PAY-1', url: 'https://acme.atlassian.net/browse/PAY-1', title: 'Retry storms', updatedAt: '2026-09-28', text: 'Retry storms caused 1,240 duplicate charges in September.' }] });
    await call(fx, 'sources', { action: 'report', id: 'confluence', partial: true, items: [{ ref: '98765', url: PAGE, title: 'Checkout retries', updatedAt: '2026-09-20', text: 'Checkout retries every payment call up to 5 times with no idempotency key.' }] });
    await call(fx, 'sources', { action: 'report', id: 'github', partial: true, items: [{ ref: 'acme/checkout#311', url: 'https://github.com/acme/checkout/pull/311', title: 'Add idempotency keys', text: 'This PR adds an idempotency key to every payment call and caps retries at 3.' }] });

    const started = await call(fx, 'start_outcome', { workflowId: 'rfc-authoring', input: { request: 'RFC for idempotent payment retries', target: 'docs/rfc-retries.md' } });
    assert.equal(started.preflight.status, 'runnable', started.preflight.summary);
    const runId = started.run.id as string;
    const step = async () => (await call(fx, 'claim_work', { runId })).work;
    const submit = (w: any, output: Record<string, unknown>, evidence: { ref: string; excerpt?: string }[]) =>
      call(fx, 'submit_work', { stepRunId: w.stepRunId, owner: w.owner, token: w.token, output, evidence });

    const cited = [
      { ref: 'jira:PAY-1', excerpt: '1,240 duplicate charges' },
      { ref: `${PAGE}#current-behaviour`, excerpt: 'up to 5 times with no idempotency key' },
      { ref: 'acme/checkout#311', excerpt: 'caps retries at 3' },
    ];
    let w = await step();
    assert.equal(w.step.id, 'gather');
    const gathered = await submit(w, { summary: 'retries duplicate charges', findings: ['retry storms'], material: ['PAY-1', 'retries page', 'PR 311'], conflicts: [], unknowns: [] }, cited);
    assert.equal(gathered.step.state, 'succeeded', JSON.stringify(gathered.validation));

    writeFileSync(join(fx.broker.root, 'docs', 'rfc-retries.md'), '# RFC: Idempotent payment retries\n## Problem\nRetries ran up to 5 times and caused 1,240 duplicate charges in September.\n## Proposal\nAdd an idempotency key and cap retries at 3.\n');
    w = await step();
    assert.equal(w.step.id, 'draft');
    const invented = await submit(w, { summary: 'draft', findings: ['cap retries'], artifact: 'docs/rfc-retries.md', derivations: [] }, [...cited, { ref: 'jira:PAY-999', excerpt: 'the outage ticket' }]);
    assert.notEqual(invented.step.state, 'succeeded');
    const problems = invented.validation.flatMap((v: { problems: string[] }) => v.problems) as string[];
    assert.ok(problems.some((p) => p.includes('"jira:PAY-999" names nothing this project holds') && p.includes('sources tool (action report)')), problems.join(' | '));

    w = await step();
    const draft = await submit(w, { summary: 'draft', findings: ['cap retries'], artifact: 'docs/rfc-retries.md', derivations: [] }, cited);
    assert.equal(draft.step.state, 'succeeded', JSON.stringify(draft.validation));
    assert.ok(draft.validation.some((v: { validator: string; ok: boolean }) => v.validator === 'evidence_recorded' && v.ok), 'connector-only recorded reads hold content Construct can check');
    assert.ok(draft.validation.some((v: { validator: string; ok: boolean }) => v.validator === 'numbers_grounded' && v.ok), 'figures are grounded in the recorded text');
    assert.deepEqual(draft.evidence, { witnessed: 0, reported: 3, unverified: 0, unresolved: 0 });
  } finally {
    fx.cleanup();
  }
});
