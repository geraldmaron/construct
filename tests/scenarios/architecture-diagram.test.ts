/**
 * tests/scenarios/architecture-diagram.test.ts — the flagship request, end to
 * end through the broker tools with no command line: "Create an architecture
 * diagram of our system from Jira/Confluence and GitHub, only covering
 * 2026-07-01 to 2026-09-30", in a product repository shaped like the one the
 * request was probed against. The session declares the named systems,
 * reports what it read from them, reports its typed reading to
 * classify_request, and starts the general carrier with the intake it got
 * back, so the period and the sources come from the reading. The do step,
 * which carries the method the reading chose, is sent back for a ticket dated after
 * the period until it is explained, for a figure nothing cited contains, and
 * for a named source nothing was cited from; the verify step then hands back
 * a validated deliverable that carries the diagram, what it rests on, and
 * where that falls against the period and the named sources.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS } from '../../src/kernel/broker/tools.ts';
import { record } from '../../src/kernel/broker/definition.ts';
import { citedFiguresIn, figuresIn } from '../../src/kernel/workflow/validators.ts';
import { brokerFixture } from '../kernel/broker/support.ts';

type Fx = ReturnType<typeof brokerFixture>;
const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
async function call(fx: Fx, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const t = tool(name);
  return t.run(fx.broker, t.validate(record(args)));
}
async function claim(fx: Fx, runId: string): Promise<any> {
  return call(fx, 'claim_work', { runId });
}
async function submit(fx: Fx, work: any, output: Record<string, unknown>, evidence: { ref: string; excerpt?: string }[]): Promise<any> {
  return call(fx, 'submit_work', { stepRunId: work.stepRunId, token: work.token, output, evidence });
}
const failing = (r: { validation: { validator: string; ok: boolean }[] }) => r.validation.filter((v) => !v.ok).map((v) => v.validator);

const COMPOSE = [
  'services:',
  '  checkout:',
  '    build: ./services/checkout',
  '    ports:',
  '      - "8080:8080"',
  '  ledger:',
  '    build: ./services/ledger',
  '    ports:',
  '      - "9090:9090"',
  '  payments-db:',
  '    image: postgres:16',
  '    ports:',
  '      - "5432:5432"',
  '',
].join('\n');

/** A Mermaid C4 container diagram whose every figure comes from the compose file. */
function diagram(extra = ''): string {
  return [
    '# Payments architecture, Q3 2026',
    '',
    '```mermaid',
    'C4Container',
    '  title Payments containers, from evidence dated 2026-07-01 to 2026-09-30',
    '  Person(customer, "Customer")',
    '  Container(checkout, "checkout", "TypeScript", "Public entry point on port 8080")',
    '  Container(ledger, "ledger", "Go", "Records payments on port 9090")',
    '  ContainerDb(db, "payments-db", "Postgres 16", "Listens on 5432")',
    '  Rel(customer, checkout, "HTTPS")',
    `  Rel(checkout, ledger, "gRPC${extra}")`,
    '  Rel(ledger, db, "SQL")',
    '```',
    '',
    'Cart moves out of checkout after the quarter (PAY-430); it is not drawn here.',
    '',
  ].join('\n');
}

const CONFLUENCE_URL = 'https://acme.atlassian.net/wiki/spaces/ENG/pages/98765/Payments+architecture';

test('the architecture diagram request runs end to end through the tools: period and named sources reach every step, honest work is checked, and the deliverable carries what was made', async () => {
  const fx = brokerFixture();
  try {
    const root = fx.broker.root;
    mkdirSync(join(root, 'services', 'checkout'), { recursive: true });
    mkdirSync(join(root, 'services', 'ledger'), { recursive: true });
    writeFileSync(join(root, 'services', 'checkout', 'server.ts'), 'export const PORT = 8080;\n');
    writeFileSync(join(root, 'services', 'ledger', 'main.go'), 'package main\n\nconst port = 9090\n');
    writeFileSync(join(root, 'docker-compose.yml'), COMPOSE);
    writeFileSync(join(root, 'docs', 'architecture-notes.md'), '# Architecture notes\n\nCheckout is the only public entry point. The ledger is the only writer to payments-db.\n');

    // 1-2. The session declares the systems the person named and reports what it read there.
    for (const [id, kind, locator] of [['jira', 'jira', 'PAY'], ['confluence', 'docs', undefined], ['github', 'github', 'acme/payments']] as const) {
      const declared = await call(fx, 'sources', { action: 'declare', id, kind, ...(locator ? { locator } : {}) });
      assert.equal(declared.declared, true, id);
    }
    await call(fx, 'sources', { action: 'report', id: 'jira', partial: true, items: [
      { ref: 'PAY-412', url: 'https://acme.atlassian.net/browse/PAY-412', title: 'Move the ledger to Postgres 16', updatedAt: '2026-08-14T10:00:00Z', text: 'The ledger moves to Postgres 16. Checkout calls the ledger over gRPC.' },
      { ref: 'PAY-430', url: 'https://acme.atlassian.net/browse/PAY-430', title: 'Split cart out of checkout', updatedAt: '2026-10-05T08:00:00Z', text: 'Cart moves out of checkout into its own service.' },
    ] });
    await call(fx, 'sources', { action: 'report', id: 'confluence', partial: true, items: [
      { ref: '98765', url: CONFLUENCE_URL, title: 'Payments architecture', updatedAt: '2026-09-01', text: 'Customers reach checkout over HTTPS. Checkout calls the ledger, which owns the payments database.' },
    ] });
    await call(fx, 'sources', { action: 'report', id: 'github', partial: true, items: [
      { ref: 'acme/payments#311', url: 'https://github.com/acme/payments/pull/311', title: 'Add the payments-db healthcheck', updatedAt: '2026-09-20T16:00:00Z', text: 'Adds a healthcheck for payments-db in docker-compose.yml.' },
    ] });

    // 3. The host reports its reading; the general carrier starts from the intake it gets back.
    const request = 'Create an architecture diagram of our system from Jira/Confluence and GitHub, only covering 2026-07-01 to 2026-09-30';
    const read = await call(fx, 'classify_request', {
      words: request,
      kind: 'manage',
      deliverable: { kind: 'other', describe: 'architecture diagram' },
      skill: 'system-architecture',
      period: { semantics: 'evidence_window', from: '2026-07-01', to: '2026-09-30', phrase: 'only covering 2026-07-01 to 2026-09-30' },
      sources: [{ name: 'Jira' }, { name: 'Confluence' }, { name: 'GitHub' }],
    });
    assert.equal(read.matches[0].workflowId, 'managed-outcome');
    assert.deepEqual(read.questions, []);
    assert.deepEqual(read.intake.sources.map((s: { id: string }) => s.id), ['jira', 'confluence', 'github'], 'the named systems resolve to the sources the session declared');
    assert.deepEqual(read.matches[0].input.sources, ['jira', 'confluence', 'github']);
    const started = await call(fx, 'start_outcome', { workflowId: 'managed-outcome', intake: read.intake });
    assert.equal(started.started, true);
    assert.equal(started.run.state, 'ready', started.preflight.summary);
    assert.deepEqual([started.preflight.period.from, started.preflight.period.to, started.preflight.period.semantics], ['2026-07-01', '2026-09-30', 'evidence_window']);
    const runId = started.run.id as string;

    const plan = (await claim(fx, runId)).work;
    assert.equal(plan.step.id, 'plan');
    assert.equal(plan.inputs.request, request);
    assert.deepEqual([plan.inputs.period.from, plan.inputs.period.to], ['2026-07-01', '2026-09-30'], 'the plan step gets the period in dates');
    assert.deepEqual(plan.inputs.sources, ['jira', 'confluence', 'github']);
    assert.equal((await submit(fx, plan, { plan: ['read the named sources and the repo', 'draw the containers as C4'], assumptions: ['the compose file is the deployed topology'], blockers: [] }, [])).step.state, 'succeeded');

    // 4. The do step, refused in turn for each way honest-looking work goes wrong.
    let work = (await claim(fx, runId)).work;
    assert.equal(work.step.id, 'do');
    assert.equal(work.inputs.request, request, 'the do step receives the request');
    assert.deepEqual([work.inputs.period.from, work.inputs.period.to], ['2026-07-01', '2026-09-30']);
    assert.deepEqual(work.inputs.sources, ['jira', 'confluence', 'github']);
    assert.deepEqual(work.inputs.plan, ['read the named sources and the repo', 'draw the containers as C4']);
    assert.deepEqual(work.method, { id: 'system-architecture', version: work.method.version, title: 'System architecture' }, 'the do step binds no skill, so it carries the method the reading chose');
    assert.ok(work.instructions.some((i: string) => i.startsWith('Use the System architecture method for this step')));
    assert.deepEqual(work.intake.period, { semantics: 'evidence_window', from: '2026-07-01', to: '2026-09-30', phrase: 'only covering 2026-07-01 to 2026-09-30' });
    assert.ok(work.instructions.some((i: string) => i.startsWith('This run covers 2026-07-01 to 2026-09-30') && i.includes('An item updated after 2026-09-30 is refused')), work.instructions.join('\n'));
    assert.ok(work.instructions.some((i: string) => i.startsWith('Read the sources this run names: jira, confluence, github')));

    const findings = [
      { text: 'Checkout is the public entry point and calls the ledger over gRPC', citations: ['jira:PAY-412', CONFLUENCE_URL] },
      { text: 'The ledger is the only writer to payments-db, which runs Postgres 16', citations: ['docker-compose.yml', 'docs/architecture-notes.md'] },
      { text: 'payments-db gained a healthcheck in the quarter', citations: ['github:acme/payments#311'] },
    ];
    const cited = [
      { ref: 'jira:PAY-412', excerpt: 'The ledger moves to Postgres 16' },
      { ref: 'jira:PAY-430' },
      { ref: CONFLUENCE_URL, excerpt: 'Checkout calls the ledger' },
      { ref: 'github:acme/payments#311' },
      { ref: 'docker-compose.yml', excerpt: 'image: postgres:16' },
      { ref: 'docs/architecture-notes.md' },
      { ref: 'services/checkout/server.ts' },
    ];
    const outsidePeriod = [{ ref: 'jira:PAY-430', why: 'it records the cart split decided after the quarter; the diagram leaves it out and says so' }];
    const output = { summary: 'A C4 container diagram of checkout, ledger and payments-db as the evidence stood in Q3', findings, changes: ['docs/architecture.md'], artifact: 'docs/architecture.md' };

    writeFileSync(join(root, 'docs', 'architecture.md'), diagram());
    const late = await submit(fx, work, output, cited);
    assert.deepEqual(failing(late), ['within_period'], JSON.stringify(late.validation));
    assert.match(late.validation.find((v: { validator: string }) => v.validator === 'within_period').problems[0], /"jira:PAY-430" was updated 2026-10-05, after the period ends \(2026-09-30\)/);
    assert.equal(late.step.state, 'ready', 'sent back for another attempt');

    work = (await claim(fx, runId)).work;
    writeFileSync(join(root, 'docs', 'architecture.md'), diagram(', p99 420ms'));
    const invented = await submit(fx, work, { ...output, outsidePeriod }, cited);
    assert.deepEqual(failing(invented), ['numbers_grounded'], JSON.stringify(invented.validation));
    assert.match(invented.validation.find((v: { validator: string }) => v.validator === 'numbers_grounded').problems.join('\n'), /the figure "420ms" appears in no cited source/);
    // Its retries are spent: the person decides, and asks for another attempt.
    const waiver = (await claim(fx, runId)).waitingOn;
    assert.equal(waiver.kind, 'decision');
    await call(fx, 'decide', { decisionId: waiver.decision.id, resolution: 'another attempt' });

    work = (await claim(fx, runId)).work;
    writeFileSync(join(root, 'docs', 'architecture.md'), diagram());
    const unread = await submit(fx, work, { ...output, outsidePeriod }, cited.filter((e) => !e.ref.startsWith('github:')));
    assert.deepEqual(failing(unread), ['named_sources_read'], JSON.stringify(unread.validation));
    assert.match(unread.validation.find((v: { validator: string }) => v.validator === 'named_sources_read').problems[0], /this run names github, and this step cites nothing read from it/);
    await call(fx, 'decide', { decisionId: (await claim(fx, runId)).waitingOn.decision.id, resolution: 'another attempt' });

    work = (await claim(fx, runId)).work;
    const honest = await submit(fx, work, { ...output, outsidePeriod }, cited);
    assert.equal(honest.step.state, 'succeeded', JSON.stringify(honest.validation));
    assert.deepEqual(honest.evidence, { witnessed: 3, reported: 4, unverified: 0, unresolved: 0 });

    // 5. The verify step runs the project's check and hands the outcome back.
    const verify = (await claim(fx, runId)).work;
    assert.equal(verify.step.id, 'verify');
    assert.deepEqual(verify.inputs, { summary: output.summary, findings, changes: ['docs/architecture.md'], artifact: 'docs/architecture.md' });
    assert.ok(verify.instructions.includes('Construct carries summary, findings, changes, artifact into the deliverable as this step received them; return only what this step adds.'), verify.instructions.join('\n'));
    const done = await submit(fx, verify, {
      verification: { command: 'npx -y @mermaid-js/mermaid-cli -i docs/architecture.md -o /tmp/architecture.svg', exitStatus: 0, result: 'rendered one C4 container diagram' },
      passed: true,
      summary: 'Diagram rendered',
    }, [{ ref: 'docs/architecture.md' }]);
    assert.equal(done.run.state, 'succeeded', JSON.stringify(done.validation));
    assert.equal(done.deliverable.trust, 'validated');
    assert.deepEqual(done.ignored, ['summary'], 'a restated summary is named and not carried');

    const status = await call(fx, 'run_status', { runId });
    const body = status.deliverables.find((d: { id: string }) => d.id === done.deliverable.id).body;
    assert.equal(body.summary, output.summary, 'the deliverable carries what the do step made');
    assert.deepEqual(body.findings, findings);
    assert.deepEqual(body.changes, ['docs/architecture.md']);
    assert.equal(body.artifact, 'docs/architecture.md');
    assert.equal(body.passed, true);
    assert.equal(body.verification.exitStatus, 0);
    assert.equal(body.sensitivity, 'confidential', 'declared sources are treated as confidential');
    assert.deepEqual(body.provenance, { witnessed: 4, reported: 4, unverified: 0, unresolved: 0 }, 'everything the run cited: the files Construct opened and what the host reported reading');
    assert.deepEqual([body.period.semantics, body.period.from, body.period.to], ['evidence_window', '2026-07-01', '2026-09-30']);
    assert.deepEqual([...body.period.coverage.inside].sort(), ['github:acme/payments#311', 'jira:PAY-412', CONFLUENCE_URL].sort());
    assert.deepEqual(body.period.coverage.after, ['jira:PAY-430']);
    assert.deepEqual(body.period.coverage.before, []);
    assert.deepEqual([...body.period.coverage.undated].sort(), ['docker-compose.yml', 'docs/architecture-notes.md', 'docs/architecture.md', 'services/checkout/server.ts']);
    assert.deepEqual(body.period.coverage.acknowledged, outsidePeriod);
    assert.deepEqual(body.sources, { named: ['jira', 'confluence', 'github'], read: ['jira', 'confluence', 'github'], unread: [] });

    // The diagram is a Mermaid C4 file whose figures all come from the cited compose file.
    const drawn = readFileSync(join(root, body.artifact), 'utf8');
    assert.match(drawn, /```mermaid\nC4Container/);
    assert.deepEqual(figuresIn(drawn), ['8080', '9090', '16', '5432']);
    assert.deepEqual(figuresIn(COMPOSE), [], 'the compose file writes them inside other tokens');
    assert.ok(figuresIn(drawn).every((f) => citedFiguresIn(COMPOSE).includes(f)));
  } finally {
    fx.cleanup();
  }
});
