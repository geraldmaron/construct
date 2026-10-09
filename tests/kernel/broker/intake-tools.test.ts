/**
 * tests/kernel/broker/intake-tools.test.ts — classify_request takes the
 * host's typed reading and records nothing; start_outcome checks the same
 * reading again and starts nothing while a required detail or a blocking
 * question is open; the run freezes the reading, and every step works from
 * it in structured fields only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { record, ToolInputError } from '../../../src/kernel/broker/definition.ts';
import { listActivity } from '../../../src/kernel/state/activity.ts';
import { getRun, listRuns } from '../../../src/kernel/state/runs.ts';
import { askedOf } from '../../../src/kernel/workflow/asked.ts';
import { STAKE_AREAS } from '../../../src/kernel/workflow/consequence.ts';
import { readingDiffersFlag } from '../../../src/kernel/workflow/service.ts';
import { CORE_EXAMPLE, COORDINATION_NEXT, GENERAL_CARRIER, INTAKE_KINDS } from '../../../src/kernel/workflow/intake.ts';
import { createWorkflowRegistry } from '../../../src/kernel/registry/workflow-registry.ts';
import { brokerFixture } from './support.ts';

type Fx = ReturnType<typeof brokerFixture>;
const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
async function call(fx: Fx, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const t = tool(name);
  return t.run(fx.broker, t.validate(record(args)));
}
async function refusal(fx: Fx, name: string, args: Record<string, unknown>): Promise<ToolInputError> {
  const error = await call(fx, name, args).then(() => null, (e: unknown) => e);
  assert.ok(error instanceof ToolInputError, `expected wrong input, got ${String(error)}`);
  return error;
}

const WORDS = 'Create an architecture diagram of our system from Jira/Confluence, Datadog, Slack, GitHub and Notion, only covering 2026-07-01 to 2026-09-30';
const WINDOW = { semantics: 'evidence_window', from: '2026-07-01', to: '2026-09-30', phrase: 'only covering 2026-07-01 to 2026-09-30' };
const NAMED = [{ name: 'Jira' }, { name: 'Datadog' }, { name: 'Slack' }, { name: 'GitHub' }, { name: 'Notion' }];
const FLAGSHIP = { words: WORDS, kind: 'manage', deliverable: { kind: 'other', describe: 'architecture diagram' }, skill: 'system-architecture', period: WINDOW, sources: NAMED };
const UNREGISTERED = /^5 of the systems in your reading are not registered with Construct; declare each one the person named with sources action declare, then report what you read before citing it\. /;

test('classify_request takes a typed reading, records nothing, and names who judged it', async () => {
  const fx = brokerFixture();
  try {
    const before = listActivity(fx.broker.store).length;
    const r = await call(fx, 'classify_request', FLAGSHIP);
    assert.equal(listActivity(fx.broker.store).length, before, 'reading a request records nothing');
    assert.equal(r.recorded, false);
    assert.deepEqual(r.judgedBy, { by: 'host', host: 'claude-code', client: null });
    assert.equal(r.kind, 'manage');
    assert.equal(r.matches[0].workflowId, GENERAL_CARRIER);
    assert.equal(r.matches[0].because, 'other: general carrier');
    assert.deepEqual(r.questions, []);
    assert.deepEqual(r.hostQuestions, []);
    const unregistered = r.assumptions.filter((a: { about: string; by: string }) => a.about === 'sources' && a.by === 'kernel');
    assert.equal(unregistered.length, 5, 'each named system that is not registered is an assumption');
    assert.match(r.next, UNREGISTERED);
    assert.match(r.next, /Call start_outcome with workflowId "managed-outcome" and this intake/);
    assert.match(r.skills['system-architecture'].useWhen, /\S/);
    assert.ok(Object.values(r.skills).every((s: any) => s.useWhen.length <= 200));
    assert.deepEqual([r.matches[0].input.period, r.matches[0].input.request], [WINDOW, WORDS], 'the period goes into the carrier’s input as the person framed it');
    assert.deepEqual(r.intake.period, WINDOW);
    assert.deepEqual([r.resolved.period.from, r.resolved.period.to, r.resolved.period.semantics], ['2026-07-01', '2026-09-30', 'evidence_window']);
  } finally {
    fx.cleanup();
  }
});

test('the same typed reading in a polite question form gets the same matches and asks the same questions', async () => {
  const fx = brokerFixture();
  try {
    const shape = (r: any) => ({ matches: r.matches.map((m: any) => [m.workflowId, m.because, m.missing]), questions: r.questions.map((q: any) => q.slot), kind: r.kind });
    const plain = await call(fx, 'classify_request', FLAGSHIP);
    const polite = await call(fx, 'classify_request', { ...FLAGSHIP, words: 'Can you put together an architecture diagram of our system from Jira/Confluence, Datadog, Slack, GitHub and Notion for Q3, only covering 2026-07-01 to 2026-09-30?' });
    assert.deepEqual(shape(polite), shape(plain));
    assert.equal(polite.matches[0].workflowId, GENERAL_CARRIER);
  } finally {
    fx.cleanup();
  }
});

test('a reading the model can fix comes back as wrong input naming the field, its values and an example of that field', async () => {
  const fx = brokerFixture();
  try {
    const kindless = await refusal(fx, 'classify_request', { words: 'Put together the architecture diagram' });
    assert.equal(kindless.field, 'kind');
    assert.deepEqual(kindless.allowed, [...INTAKE_KINDS]);
    assert.deepEqual(kindless.example, { kind: 'manage', deliverable: { kind: 'other', describe: '<what they want back>' } }, 'an example of the one field, not a whole reading');
    const wrong = await refusal(fx, 'classify_request', { words: 'x', kind: 'work' });
    assert.equal(wrong.field, 'kind');
    assert.deepEqual(wrong.allowed, ['answer', 'remember', 'manage', 'maintain', 'coordinate']);
    const words = await refusal(fx, 'classify_request', { text: 'Remember that we ship on Fridays' });
    assert.equal(words.field, 'text');
    assert.match(words.message, /"words"/);
    assert.deepEqual(words.example, CORE_EXAMPLE);
    assert.equal((await refusal(fx, 'classify_request', { words: 'x', kind: 'manage' })).field, 'deliverable');
    assert.equal(listActivity(fx.broker.store).length, 0);
  } finally {
    fx.cleanup();
  }
});

test('an answer, a record and coordination match no workflow and say what to do instead', async () => {
  const fx = brokerFixture();
  try {
    const answer = await call(fx, 'classify_request', { words: 'What does this function do?', kind: 'answer' });
    assert.deepEqual([answer.matches, answer.next, answer.skills], [[], 'Answer in chat. Nothing was recorded.', {}]);
    const extra = await call(fx, 'classify_request', { words: 'What does this function do?', kind: 'answer', deliverable: { kind: 'publication' } });
    assert.deepEqual(extra.normalized.map((n: { why: string }) => n.why), ['an answer reading takes no deliverable, so it is ignored']);
    assert.deepEqual(extra.matches, []);
    const remember = await call(fx, 'classify_request', { words: 'Remember that we ship on Fridays', kind: 'remember' });
    assert.equal(remember.next, 'Call remember with the person’s wording and the kind of statement it is. Nothing else is created.');
    const handoff = await call(fx, 'classify_request', { words: 'Hand this off to the other agent', kind: 'coordinate', coordination: 'handoff' });
    assert.deepEqual(handoff.matches, []);
    assert.equal(handoff.next, COORDINATION_NEXT.handoff);
  } finally {
    fx.cleanup();
  }
});

test('the flagship starts from its intake with its window frozen; every step works from the reading in structured fields, never the names it could not register', async () => {
  const fx = brokerFixture();
  try {
    const read = await call(fx, 'classify_request', FLAGSHIP);
    const started = await call(fx, 'start_outcome', { workflowId: GENERAL_CARRIER, intake: read.intake });
    assert.equal(started.started, true);
    assert.equal(started.run.state, 'ready', started.preflight.summary);
    assert.equal(started.assumptions.filter((a: { about: string }) => a.about === 'sources').length, 5);
    const run = getRun(fx.broker.store, started.run.id)!;
    const asked = askedOf(run);
    assert.deepEqual(asked.intake, read.intake, 'the run keeps the reading as Construct checked it');
    assert.deepEqual([asked.period?.from, asked.period?.to, asked.period?.semantics], ['2026-07-01', '2026-09-30', 'evidence_window']);
    assert.deepEqual(asked.judgedBy, { by: 'host', host: 'claude-code', client: null });
    assert.deepEqual(asked.declared, { stakes: null, chosenSkill: 'system-architecture', words: WORDS });
    assert.equal(asked.sources?.named.filter((n) => !n.registered).length, 5);

    const plan = (await call(fx, 'claim_work', { runId: run.id })).work;
    assert.equal(plan.step.id, 'plan');
    assert.deepEqual(plan.intake, {
      deliverable: { kind: 'other', describe: 'architecture diagram' },
      period: { semantics: 'evidence_window', from: '2026-07-01', to: '2026-09-30', phrase: 'only covering 2026-07-01 to 2026-09-30' },
      sources: { registered: [], unregistered: 5 },
      destination: null,
      assumptions: plan.intake.assumptions,
    });
    assert.ok(plan.intake.assumptions.every((a: { about: string; by: string }) => !(a.about === 'sources' && a.by === 'kernel')), 'a note that names an unregistered system stays out of the packet');
    assert.ok(plan.instructions.some((i: string) => i.startsWith('This run covers 2026-07-01 to 2026-09-30')), plan.instructions.join('\n'));
    assert.ok(plan.instructions.includes('This request named 5 system(s) that are not registered with Construct. Read only ones the person named, declare each with sources action declare and report what you read before citing it; say plainly that Construct could not check anything you did not report.'));
    const packet = JSON.stringify({ intake: plan.intake, instructions: plan.instructions });
    for (const name of ['Datadog', 'Slack', 'Notion']) assert.ok(!packet.includes(name), `the packet never names ${name}`);
    assert.equal(plan.method, null, 'the plan step binds its own skill');
    await call(fx, 'submit_work', { stepRunId: plan.stepRunId, token: plan.token, output: { plan: ['read and draw'], assumptions: [], blockers: [] } });
    const doStep = (await call(fx, 'claim_work', { runId: run.id })).work;
    assert.equal(doStep.step.id, 'do');
    assert.equal(doStep.skill, null);
    assert.equal(doStep.method.id, 'system-architecture');
    assert.equal(doStep.method.title, 'System architecture');
    assert.ok(doStep.instructions.some((i: string) => i.startsWith('Use the System architecture method for this step; load it with skills show (id system-architecture) and includeBody.')));
  } finally {
    fx.cleanup();
  }
});

test('once the named systems are declared, the reading resolves them and the run reads them', async () => {
  const fx = brokerFixture();
  try {
    for (const [id, kind] of [['jira', 'jira'], ['datadog', 'other'], ['slack', 'other'], ['github', 'github'], ['notion', 'docs']] as const) {
      assert.equal((await call(fx, 'sources', { action: 'declare', id, kind })).declared, true);
    }
    const read = await call(fx, 'classify_request', FLAGSHIP);
    assert.doesNotMatch(read.next, /not registered/);
    assert.deepEqual(read.intake.sources.map((s: { id: string }) => s.id), ['jira', 'datadog', 'slack', 'github', 'notion']);
    const started = await call(fx, 'start_outcome', { workflowId: GENERAL_CARRIER, intake: read.intake });
    const asked = askedOf(getRun(fx.broker.store, started.run.id)!);
    assert.deepEqual(asked.sources?.registered, ['jira', 'datadog', 'slack', 'github', 'notion']);
    assert.deepEqual([asked.period?.from, asked.period?.to], ['2026-07-01', '2026-09-30']);
    const plan = (await call(fx, 'claim_work', { runId: started.run.id })).work;
    assert.deepEqual(plan.intake.sources, { registered: ['jira', 'datadog', 'slack', 'github', 'notion'], unregistered: 0 });
    assert.ok(plan.instructions.some((i: string) => i.startsWith('Read the sources this run names: jira, datadog, slack, github, notion')));
  } finally {
    fx.cleanup();
  }
});

test('start_outcome starts nothing while a required detail or a blocking question is open, and refuses a reading or a workflow it cannot start', async () => {
  const fx = brokerFixture();
  try {
    const prd = { words: 'Write a PRD for public webhooks', kind: 'manage', deliverable: { kind: 'document/prd' } };
    const missing = await call(fx, 'start_outcome', { workflowId: 'prd-authoring', intake: prd });
    assert.equal(missing.started, false);
    assert.equal(missing.recorded, false);
    assert.deepEqual(missing.questions.map((q: { slot: string }) => q.slot), ['target']);
    assert.match(missing.next, /^Nothing started/);
    assert.match(missing.next, /Do not downgrade required permission, essential scope or destination decisions/);
    assert.deepEqual(listRuns(fx.broker.store), [], 'no run is left for a missing input');

    const open = await call(fx, 'start_outcome', { workflowId: 'prd-authoring', intake: { ...prd, target: 'docs/prd.md', open: [{ about: 'audience', question: 'Is this for the partner team or for customers?', blocking: true }] } });
    assert.equal(open.started, false);
    assert.deepEqual(open.questions, []);
    assert.deepEqual(open.hostQuestions, [{ about: 'audience', question: 'Is this for the partner team or for customers?' }]);
    assert.deepEqual(listRuns(fx.broker.store), []);

    assert.equal((await refusal(fx, 'start_outcome', { workflowId: 'prd-authoring', intake: { words: 'What is a PRD?', kind: 'answer' } })).field, 'kind');
    const elsewhere = await refusal(fx, 'start_outcome', { workflowId: 'design-conformance', intake: { ...prd, target: 'docs/prd.md' } });
    assert.equal(elsewhere.field, 'workflowId');
    assert.deepEqual(elsewhere.allowed, ['prd-authoring', 'proposal-authoring', 'revise-deliverable', 'rfc-authoring'], 'the workflows this reading matched: its kind, then its family in registry order');
    assert.equal((await refusal(fx, 'start_outcome', { workflowId: 'prd-authoring' })).field, 'intake');
    assert.equal((await refusal(fx, 'start_outcome', { workflowId: 'prd-authoring', intake: { ...prd, target: 'docs/prd.md', inputs: { bogus: 1 } } })).field, 'inputs.bogus');
    assert.deepEqual(listRuns(fx.broker.store), []);

    const publish = { words: 'Publish the summary to the engineering wiki', kind: 'manage', deliverable: { kind: 'publication' }, destination: { kind: 'external', ref: 'https://wiki.example.com/eng' } };
    const conflict = await call(fx, 'start_outcome', { workflowId: 'publish-deliverable', intake: publish, input: { deliverable: 'deliverable-1', audience: 'engineering', destination: 'https://elsewhere.example.com/x' } });
    assert.equal(conflict.started, false, 'two places for the result is the person’s call');
    assert.deepEqual(conflict.questions.map((q: { slot: string }) => q.slot), ['destination']);
    assert.deepEqual(conflict.questions[0].options.map((o: { value: string }) => o.value), ['https://wiki.example.com/eng', 'https://elsewhere.example.com/x']);
    assert.deepEqual(listRuns(fx.broker.store), []);
  } finally {
    fx.cleanup();
  }
});

test('without an intake a missing input starts nothing and an undeclared one is refused, while the command line still keeps a blocked run', async () => {
  const fx = brokerFixture();
  try {
    const missing = await call(fx, 'start_outcome', { workflowId: 'prd-authoring', input: { request: 'PRD for webhooks' } });
    assert.equal(missing.started, false);
    assert.deepEqual(missing.questions.map((q: { slot: string; neededBy: string }) => [q.slot, q.neededBy]), [['target', 'prd-authoring']]);
    assert.deepEqual(listRuns(fx.broker.store), []);
    const stray = await refusal(fx, 'start_outcome', { workflowId: 'prd-authoring', input: { request: 'PRD for webhooks', target: 'docs/prd.md', dateRange: 'Q3' } });
    assert.equal(stray.field, 'input.dateRange');
    assert.deepEqual(stray.allowed, ['request', 'target', 'template']);
    const unknown = await refusal(fx, 'start_outcome', { workflowId: 'remember', input: {} });
    assert.equal(unknown.field, 'workflowId');
    assert.ok(!unknown.allowed?.includes('remember'));
    assert.deepEqual(listRuns(fx.broker.store), []);
    const cli = fx.broker.workflow.start({ workflowId: 'prd-authoring', input: { request: 'PRD for webhooks' }, trigger: 'manual' });
    assert.equal(cli.run.state, 'blocked', 'service.start keeps a blocked run for the command line and triggers');
    assert.ok(cli.preflight.questions.some((q) => q.slot === 'target'), 'its preflight asks the same question');
  } finally {
    fx.cleanup();
  }
});

test('a different window is different work, the same window is the same run, and a different reading of it is flagged', async () => {
  const fx = brokerFixture();
  try {
    const base = { words: 'Draw the payments architecture', kind: 'manage', deliverable: { kind: 'other', describe: 'architecture diagram' }, target: 'docs/architecture.md' };
    const q2 = await call(fx, 'start_outcome', { workflowId: GENERAL_CARRIER, intake: { ...base, period: { semantics: 'evidence_window', relative: 'last_quarter' } } });
    assert.deepEqual([q2.started, q2.created], [true, true]);
    const q3 = await call(fx, 'start_outcome', { workflowId: GENERAL_CARRIER, intake: { ...base, period: { semantics: 'evidence_window', quarter: 3, year: 2026 } } });
    assert.equal(q3.created, true, 'the same target over another window is another piece of work');
    assert.notEqual(q3.run.id, q2.run.id);
    const again = await call(fx, 'start_outcome', { workflowId: GENERAL_CARRIER, intake: { ...base, period: { semantics: 'evidence_window', from: '2026-07-01', to: '2026-09-30' }, deliverable: { kind: 'other', describe: 'container diagram' } } });
    assert.equal(again.created, false, 'the same window, given as dates, is the same work');
    assert.equal(again.run.id, q3.run.id);
    assert.ok(again.preflight.flags.includes(readingDiffersFlag(q3.run.id, ['deliverable', 'period'])), again.preflight.flags.join('\n'));
    assert.match(readingDiffersFlag(q3.run.id, ['words', 'open']), /from a reading that differs in its words and open items; it keeps its own reading/);
  } finally {
    fx.cleanup();
  }
});

test('stakes the host reports only raise rigor, and the run keeps them', async () => {
  const fx = brokerFixture();
  try {
    const reading = { words: 'Rename the invoice helper', kind: 'manage', deliverable: { kind: 'other', describe: 'renamed helper' } };
    const calm = await call(fx, 'classify_request', reading);
    assert.equal(calm.judgment.challenge, false);
    const hard = await call(fx, 'classify_request', { ...reading, stakes: { reversible: false, affects: ['production'] } });
    assert.equal(hard.judgment.challenge, true);
    assert.match(hard.next, / This work must be challenged before it is accepted\.$/);
    const started = await call(fx, 'start_outcome', { workflowId: GENERAL_CARRIER, intake: hard.intake });
    assert.equal(started.preflight.judgment.challenge, true);
    const plan = (await call(fx, 'claim_work', { runId: started.run.id })).work;
    assert.equal(plan.judgment.challenge, true);
    assert.ok(plan.instructions.some((i: string) => i.startsWith('This run must be challenged before it is accepted')));
  } finally {
    fx.cleanup();
  }
});

test('the published reading carries the stake areas the judge reads, and the description names every kind a workflow declares', () => {
  const schema = tool('classify_request').inputSchema;
  const stakes = schema.properties.stakes as unknown as { properties: { affects: { items: { enum: readonly string[] } } } };
  assert.deepEqual(stakes.properties.affects.items.enum, [...STAKE_AREAS]);
  assert.deepEqual(schema.required, ['words', 'kind']);
  assert.deepEqual((schema.properties.kind as { enum: readonly string[] }).enum, [...INTAKE_KINDS]);
  const description = tool('classify_request').description;
  const workflows = createWorkflowRegistry({ projectDir: null }).list().filter((w) => (w.manifest.interactionClass === 'manage' || w.manifest.interactionClass === 'maintain') && w.manifest.id !== GENERAL_CARRIER);
  for (const kind of new Set(workflows.map((w) => w.manifest.deliverable.kind))) {
    const [family, leaf] = kind.includes('/') ? kind.split('/') as [string, string] : [kind, null];
    const named = leaf === null ? new RegExp(`\\b${family}\\b`) : new RegExp(`\\b${family}/(?:${leaf}\\b| [^;]*\\b${leaf}\\b)`);
    assert.match(description, named, `the description names ${kind}`);
  }
});


test('standing intake records an idempotent definition, preserves input, and creates no immediate run or executor', async () => {
  const fx = brokerFixture();
  try {
    for (const [workflowId, deliverable, kind] of [['managed-outcome', { kind: 'other', describe: 'a status brief' }, 'schedule'], ['source-drift-review', { kind: 'review/drift' }, 'event']] as const) {
      const intake = { words: 'Keep the current policy and implementation reviewed; save a local status brief.', kind: 'maintain', workflowId, deliverable, scope: 'docs/design.md', schedule: kind === 'schedule' ? { cron: '0 9 * * 1', timezone: 'Pacific/Auckland' } : { event: 'source.corrected' } };
      const first = await call(fx, 'start_outcome', { workflowId, intake });
      assert.equal(first.started, false); assert.equal(first.scheduled, true);
      assert.deepEqual(first.provisioning, { clock: 'unprovisioned', executor: 'unprovisioned' });
      assert.equal(first.triggers[0].created, true);
      assert.equal(first.triggers[0].trigger.kind, kind);
      assert.equal(first.triggers[0].trigger.delivery.intake.words, intake.words);
      const repeated = await call(fx, 'start_outcome', { intake: { ...intake }, workflowId });
      assert.equal(repeated.triggers[0].created, false);
      assert.equal(repeated.triggers[0].trigger.id, first.triggers[0].trigger.id);
      assert.equal(listRuns(fx.broker.store).filter((run) => run.workflowId === workflowId).length, 0);
      const fired = fx.broker.triggers.fire({ triggerId: first.triggers[0].trigger.id, firingKey: 'test-occurrence' });
      const asked = askedOf(getRun(fx.broker.store, fired.runId!)!);
      assert.equal(asked.intake?.words, intake.words);
      assert.equal(asked.judgedBy?.by, 'trigger_definition');
    }
  } finally { fx.cleanup(); }
});


test('an outcome cannot finish in state alone when the person requested a local file', async () => {
  const fx = brokerFixture();
  try {
    const started = await call(fx, 'start_outcome', { workflowId: 'managed-outcome', intake: { words: 'Write a local design brief.', kind: 'manage', deliverable: { kind: 'other', describe: 'design brief' }, destination: { kind: 'project_file', ref: 'brief.md' } } });
    const runId = started.run.id;
    const submitNext = async (output: Record<string, unknown>) => { const w = (await call(fx, 'claim_work', { runId })).work; return call(fx, 'submit_work', { stepRunId: w.stepRunId, owner: w.owner, token: w.token, output, evidence: [{ ref: 'docs/design.md' }] }); };
    await submitNext({ plan: ['Read design and write brief'], assumptions: [], blockers: [] });
    const work = await submitNext({ summary: 'Kernel stays host-agnostic', findings: ['The design keeps the kernel host-agnostic.'], changes: [], artifact: null });
    assert.equal(work.step.state, 'succeeded');
    const end = await submitNext({ verification: { result: 'Inspected design context' }, passed: true });
    assert.ok(end.validation.some((check: any) => check.validator === 'requested_destination' && check.ok === false));
    assert.notEqual(end.run.state, 'succeeded');
    assert.equal(end.deliverable, null);
  } finally { fx.cleanup(); }
});


for (const handling of ['investigate', 'carry_unknown']) {
  test(`an explicit ${handling} evidence gap starts research and survives in the packet without a fabricated assumption`, async () => {
    const fx = brokerFixture();
    try {
      const gap = { about: 'sources', question: 'Which measurement definition is current?', blocking: false, handling };
      const reading = await call(fx, 'classify_request', { words: 'Investigate the conflicting measurements and report what remains unknown.', kind: 'manage', deliverable: { kind: 'research/brief' }, open: [gap] });
      assert.deepEqual(reading.hostQuestions, []);
      assert.ok(!reading.assumptions.some((a: any) => a.by === 'host'));
      assert.equal(reading.intake.open[0].assumption, null);
      assert.equal(reading.matches[0].workflowId, 'research-brief');
      const started = await call(fx, 'start_outcome', { workflowId: 'research-brief', intake: reading.intake });
      assert.equal(started.started, true);
      assert.equal(askedOf(getRun(fx.broker.store, started.run.id)!).intake!.open[0]!.handling, handling);
      const next = (await call(fx, 'claim_work', { runId: started.run.id })).work;
      assert.equal(next.step.tier, 'observe');
      assert.deepEqual(next.intake.evidenceGaps, [{ about: 'sources', question: gap.question, handling }]);
      assert.ok(next.instructions.some((instruction: string) => instruction.includes('not assumed facts')));
    } finally { fx.cleanup(); }
  });
}

test('explicit evidence handling cannot simultaneously claim an assumed answer or person blocker', async () => {
  const fx = brokerFixture();
  try {
    const base = { words: 'Research current measurements.', kind: 'manage', deliverable: { kind: 'research/brief' } };
    for (const extra of [{ blocking: true }, { blocking: false, assumption: 'The missing field means cases.' }, { blocking: false, handling: 'approved' }]) {
      await refusal(fx, 'classify_request', { ...base, open: [{ question: 'What does this field mean?', handling: 'investigate', ...extra }] });
    }
    assert.equal(listActivity(fx.broker.store).length, 0);
  } finally { fx.cleanup(); }
});

test('carrying an unknown cannot supply a required destination or waive an actual decision', async () => {
  const fx = brokerFixture();
  try {
    const gap = { question: 'What do the unavailable records establish?', blocking: false, handling: 'carry_unknown' };
    const missing = await call(fx, 'start_outcome', { workflowId: 'prd-authoring', intake: { words: 'Write a PRD.', kind: 'manage', deliverable: { kind: 'document/prd' }, open: [gap] } });
    assert.equal(missing.started, false);
    assert.ok(missing.questions.some((q: any) => q.slot === 'target'));
    const blocked = await call(fx, 'start_outcome', { workflowId: 'research-brief', intake: { words: 'Research the confidential records after the owner permits access.', kind: 'manage', deliverable: { kind: 'research/brief' }, open: [gap, { about: 'scope', question: 'Has the owner permitted this access?', blocking: true }] } });
    assert.equal(blocked.started, false);
    assert.deepEqual(blocked.hostQuestions, [{ about: 'scope', question: 'Has the owner permitted this access?' }]);
    assert.deepEqual(listRuns(fx.broker.store), []);
  } finally { fx.cleanup(); }
});
