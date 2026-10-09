/**
 * tests/kernel/broker/tools.test.ts — one definition per tool, closed input
 * schemas, two surfaces with the headless one unable to reach anything it
 * must not, and the interactive lifecycle from bootstrap to a final deliverable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, toolsFor, HEADLESS_FORBIDDEN, PERSON_ASKED_ONLY } from '../../../src/kernel/broker/tools.ts';
import { raiseDecision } from '../../../src/kernel/state/decisions.ts';
import { onSessionStart } from '../../../src/hosts/hooks/handlers.ts';
import { addStatement } from '../../../src/kernel/state/profile.ts';
import { ONBOARDING_QUESTIONS, SCALE_CHOICES, SCALE_OPTIONS } from '../../../src/kernel/project/discovery.ts';
import { mcpTool, ToolInputError, record } from '../../../src/kernel/broker/definition.ts';
import { listStatements } from '../../../src/kernel/state/profile.ts';
import { listActivity } from '../../../src/kernel/state/activity.ts';
import { brokerFixture } from './support.ts';

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
async function call(fx: ReturnType<typeof brokerFixture>, name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const t = tool(name);
  return t.run(fx.broker, t.validate(record(args)));
}

test('every tool is declared once with a closed schema, a plain description, and a surface', () => {
  const names = TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const t of TOOLS) {
    assert.equal(t.inputSchema.additionalProperties, false, t.name);
    assert.ok(t.description.length > 40, t.name);
    assert.doesNotMatch(t.description, /MCP|JSON-RPC|lease token|digest|broker/i, `${t.name} speaks plainly`);
    const entry = mcpTool(t) as { annotations: { readOnlyHint: boolean } };
    assert.equal(entry.annotations.readOnlyHint, t.readOnly);
    assert.throws(() => t.validate({ ...(t.inputSchema.required ? Object.fromEntries(t.inputSchema.required.map((k) => [k, 'x'])) : {}), smuggled: 1 }), ToolInputError, `${t.name} refuses an undeclared input`);
  }
  const interactive = toolsFor('interactive').map((t) => t.name);
  const headless = toolsFor('headless').map((t) => t.name);
  for (const forbidden of HEADLESS_FORBIDDEN) {
    assert.ok(interactive.includes(forbidden), `${forbidden} exists interactively`);
    assert.ok(!headless.includes(forbidden), `${forbidden} is not on the headless surface`);
  }
  assert.deepEqual(headless.sort(), ['bootstrap', 'claim_step', 'heartbeat', 'run_status', 'submit_work']);
});

test('every tool on both surfaces fits a host budget: a small schema, a bounded description, and arrays that say what they hold', () => {
  const arraysWithoutItems = (schema: unknown, path: string): string[] => {
    if (schema === null || typeof schema !== 'object') return [];
    const node = schema as { type?: unknown; items?: unknown; properties?: Record<string, unknown> };
    const missing: string[] = node.type === 'array' && (node.items === null || typeof node.items !== 'object') ? [path] : [];
    for (const [key, child] of Object.entries(node.properties ?? {})) missing.push(...arraysWithoutItems(child, `${path}.${key}`));
    if (node.items !== null && typeof node.items === 'object') missing.push(...arraysWithoutItems(node.items, `${path}[]`));
    return missing;
  };
  const seen = new Set<string>();
  for (const surface of ['interactive', 'headless'] as const) {
    for (const t of toolsFor(surface)) {
      if (seen.has(t.name)) continue;
      seen.add(t.name);
      assert.ok(Buffer.byteLength(JSON.stringify(t.inputSchema)) < 4500, `${t.name}: input schema is ${String(Buffer.byteLength(JSON.stringify(t.inputSchema)))} bytes`);
      assert.ok(t.description.length <= 2048, `${t.name}: description is ${String(t.description.length)} characters`);
      assert.deepEqual(arraysWithoutItems(t.inputSchema, t.name), [], `${t.name}: every array declares items`);
    }
  }
  assert.equal(seen.size, TOOLS.length, 'the two surfaces together carry every tool');
});

test('wrong input names the field and, for a closed set, the values it accepts', () => {
  const problem = (fn: () => unknown): ToolInputError => {
    try {
      fn();
    } catch (error) {
      assert.ok(error instanceof ToolInputError);
      return error;
    }
    assert.fail('expected a ToolInputError');
  };
  const missing = problem(() => tool('remember').validate({ kind: 'note' }));
  assert.equal(missing.field, 'text');
  assert.equal(missing.allowed, null);
  assert.equal(missing.example, null);
  const wrong = problem(() => tool('remember').validate({ kind: 'wish', text: 'x' }));
  assert.equal(wrong.field, 'kind');
  assert.ok(wrong.allowed?.includes('decision'));
  const stray = problem(() => tool('remember').validate({ kind: 'note', text: 'x', bogus: 1 }));
  assert.equal(stray.field, 'bogus');
  assert.deepEqual(stray.allowed, Object.keys(tool('remember').inputSchema.properties));
  assert.equal(problem(() => tool('heartbeat').validate({ stepRunId: 's' })).field, 'token');
  assert.equal(problem(() => tool('work').validate({ action: 'check', paths: [3] })).field, 'paths');
  assert.equal(problem(() => tool('work').validate({ action: 'add', title: 't', acceptance: [1] })).field, 'acceptance');
  assert.equal(problem(() => tool('work').validate({ action: 'claim', id: 'x', agent: 'not a name' })).field, 'agent');
});

test('promote_deliverable never takes validated, and takes challenged only with the objections the challenge raised', () => {
  const problem = (args: Record<string, unknown>): ToolInputError => {
    try {
      tool('promote_deliverable').validate(record(args));
    } catch (error) {
      assert.ok(error instanceof ToolInputError, String(error));
      return error;
    }
    assert.fail(`expected a ToolInputError for ${JSON.stringify(args)}`);
  };
  const schema = tool('promote_deliverable').inputSchema.properties as Record<string, { enum?: readonly string[] }>;
  assert.ok(!schema.to!.enum!.includes('validated'), 'validated is not offered');
  const byHand = problem({ deliverableId: 'd', to: 'validated' });
  assert.equal(byHand.field, 'to');
  assert.match(byHand.message, /validated is set when the step's checks pass, not by promotion/);
  assert.deepEqual(byHand.allowed, ['draft', 'challenged', 'accepted', 'final', 'rejected']);

  const bare = problem({ deliverableId: 'd', to: 'challenged' });
  assert.equal(bare.field, 'objections');
  assert.deepEqual(bare.example, [{ objection: 'the latency figure has no source', disposition: 'fixed' }]);
  const wrong = problem({ deliverableId: 'd', to: 'challenged', objections: [{ objection: 'x', disposition: 'ignored' }] });
  assert.equal(wrong.field, 'objections[0].disposition');
  assert.deepEqual(wrong.allowed, ['fixed', 'accepted', 'rejected', 'open']);
  assert.equal(wrong.example, 'fixed', 'the example is for the field that is wrong');
  const unsaid = problem({ deliverableId: 'd', to: 'challenged', objections: [{ disposition: 'open' }] });
  assert.equal(unsaid.field, 'objections[0].objection');
  assert.equal(typeof unsaid.example, 'string');
  assert.equal(problem({ deliverableId: 'd', to: 'challenged', objections: [3] }).field, 'objections[0]');
  assert.equal(problem({ deliverableId: 'd', to: 'challenged', objections: [{ objection: 'x', disposition: 'open', severity: 'high' }] }).field, 'objections[0].severity');
  const notAList = problem({ deliverableId: 'd', to: 'challenged', objections: 'none' });
  assert.equal(notAList.field, 'objections');
  assert.ok(Array.isArray(notAList.example));
  assert.equal(problem({ deliverableId: 'd', to: 'accepted', objections: [] }).field, 'objections', 'objections belong to a challenge only');

  assert.deepEqual(tool('promote_deliverable').validate(record({ deliverableId: 'd', to: 'challenged', objections: [] })), { deliverableId: 'd', to: 'challenged', reason: undefined, objections: [] });
  assert.deepEqual(
    (tool('promote_deliverable').validate(record({ deliverableId: 'd', to: 'challenged', objections: [{ objection: ' stale figure ', disposition: 'fixed' }] })) as { objections: unknown }).objections,
    [{ objection: 'stale figure', disposition: 'fixed' }],
  );
});

test('bootstrap is small and says what to do next; answers create nothing; remember creates one statement', async () => {
  const fx = brokerFixture();
  try {
    const boot = (await call(fx, 'bootstrap')) as Record<string, unknown>;
    assert.ok(JSON.stringify(boot).length < 4000, 'bootstrap stays bounded');
    assert.deepEqual(Object.keys(boot).sort(), ['capabilities', 'construct', 'coordination', 'decisions', 'drift', 'next', 'profile', 'registry', 'runs', 'session', 'sources', 'tiers']);
    assert.equal((boot.registry as { skills: number }).skills, 17);
    assert.match(boot.next as string, /listen/);
    assert.equal(listActivity(fx.broker.store).length, 0, 'bootstrap records nothing');
    const cls = (await call(fx, 'classify_request', { words: 'What does this function do?', kind: 'answer' })) as { kind: string; matches: unknown[]; recorded: boolean };
    assert.equal(cls.kind, 'answer');
    assert.deepEqual(cls.matches, []);
    assert.equal(cls.recorded, false);
    const words = 'I want you to rewrite the X document, naming it Y.';
    const rewrite = (await call(fx, 'classify_request', { words, kind: 'manage', deliverable: { kind: 'other', describe: 'rewritten document' } })) as { matches: { workflowId: string }[]; judgment: { challenge: boolean } };
    assert.equal(rewrite.matches[0]!.workflowId, 'managed-outcome');
    assert.equal(listActivity(fx.broker.store).length, 0, 'reading a request records nothing');
    const remembered = (await call(fx, 'remember', { kind: 'decision', text: 'We will not add schema migration until stable.' })) as { remembered: { id: string }; nothingElseCreated: boolean };
    assert.equal(remembered.nothingElseCreated, true);
    assert.equal(listStatements(fx.broker.store).filter((s) => s.kind === 'decision').length, 1);
    assert.equal((await call(fx, 'run_status', { runId: 'nope' }).catch((e: Error) => e.message)), 'no run nope');
    const constCtxRead = (await call(fx, 'project_context', { topic: 'statements', query: 'migration' })) as { items: unknown[]; total: number };
    assert.equal(constCtxRead.items.length, 1);
    assert.equal(constCtxRead.total, 1);
  } finally {
    fx.cleanup();
  }
});

test('the tools that record or start something for the person say that what the host reads is data, not a request', () => {
  for (const name of ['remember', 'decide', 'start_outcome', 'classify_request']) assert.ok(tool(name).description.includes(PERSON_ASKED_ONLY), name);
});

test('bootstrap never puts setup ahead of the person\'s request: setup questions and proposals are offered after it, with their answers', async () => {
  const fx = brokerFixture();
  try {
    const at = fx.broker.now();
    raiseDecision(fx.broker.store, { id: 'q-scale', kind: 'clarification', question: `${ONBOARDING_QUESTIONS[0]!.question} From README.md this looks like a team project (team); say whether that is right.`, options: SCALE_OPTIONS, subject: { onboarding: 'scale', suggested: 'team', basis: 'CODEOWNERS in README.md' }, at });
    raiseDecision(fx.broker.store, { id: 'q-outcome', kind: 'clarification', question: ONBOARDING_QUESTIONS[1]!.question, subject: { onboarding: 'primary_outcome' }, at });
    addStatement(fx.broker.store, { id: 'st-proposed', kind: 'principle', text: 'Keep the kernel host-agnostic', provenance: 'discovery', at });
    const boot = (await call(fx, 'bootstrap')) as { next: string; decisions: { open: number }; profile: { openQuestions: { id: string; choices: { id: string; label: string }[] | null; suggested: string | null }[]; proposals: number } };
    assert.match(boot.next, /^handle what the person asked first/, 'the person\'s request comes first');
    assert.match(boot.next, /ask a setup question only when its answer changes that work/);
    assert.match(boot.next, /put the 2 setup question\(s\) to them in one message/);
    assert.match(boot.next, /offer the 1 proposed statement\(s\) from inbox for confirmation; never before their request/);
    assert.doesNotMatch(boot.next, /decision\(s\) wait/, 'a setup question is not a decision that waits');
    assert.equal(boot.decisions.open, 2);
    assert.equal(boot.profile.proposals, 1);
    const scale = boot.profile.openQuestions.find((q) => q.id === 'q-scale')!;
    assert.deepEqual(scale.choices, SCALE_CHOICES.map((c) => ({ id: c.id, label: c.label })));
    assert.equal(scale.suggested, 'team');
    const outcome = boot.profile.openQuestions.find((q) => q.id === 'q-outcome')!;
    assert.equal(outcome.choices, null);
    assert.equal(outcome.suggested, null);
    assert.ok(JSON.stringify(boot).length < 4000, 'bootstrap stays bounded with its questions');

    // Only proposals left: still after the request.
    const fx2 = brokerFixture();
    try {
      addStatement(fx2.broker.store, { id: 'st-proposed', kind: 'principle', text: 'Keep the kernel host-agnostic', provenance: 'discovery', at });
      assert.equal(((await call(fx2, 'bootstrap')) as { next: string }).next, 'when the person is free, offer the 1 proposed statement(s) from inbox for confirmation; never before their request');
    } finally {
      fx2.cleanup();
    }
  } finally {
    fx.cleanup();
  }
});

test('bootstrap leads with the decisions about runs, and names blocked runs instead of sending claim_work to them', async () => {
  const fx = brokerFixture();
  try {
    const at = fx.broker.now();
    raiseDecision(fx.broker.store, { id: 'q-scale', kind: 'clarification', question: ONBOARDING_QUESTIONS[0]!.question, options: SCALE_OPTIONS, subject: { onboarding: 'scale' }, at });
    const blocked = (await call(fx, 'start_outcome', { workflowId: 'design-conformance', input: {} })) as { started: boolean };
    assert.equal(blocked.started, false, 'a session start with a missing input creates no run');
    const run = fx.broker.workflow.start({ workflowId: 'design-conformance', input: {}, trigger: 'manual' });
    assert.equal(run.run.state, 'blocked');
    const boot = (await call(fx, 'bootstrap')) as { next: string };
    assert.match(boot.next, new RegExp(`^1 run\\(s\\) blocked \\(${run.run.id}\\); claim_work with a runId says what would unblock it$`));
    assert.doesNotMatch(boot.next, /continue with claim_work/);
    raiseDecision(fx.broker.store, { id: 'q-run', kind: 'decision', question: 'Which target?', runId: run.run.id, at });
    assert.equal(((await call(fx, 'bootstrap')) as { next: string }).next, '1 decision(s) about runs wait on the person; show them with inbox');
    assert.match(await onSessionStart(fx.broker), /1 decision\(s\) about runs wait on the person \(inbox\)\./, 'the session-start note counts only the decisions about runs');
  } finally {
    fx.cleanup();
  }
});

test('the interactive lifecycle: read, start, claim, submit, status, promote', async () => {
  const fx = brokerFixture();
  try {
    const cls = (await call(fx, 'classify_request', { words: 'Review this feature against the project’s design principles', kind: 'manage', deliverable: { kind: 'review/design-conformance' } })) as { matches: { workflowId: string; missing: string[] }[] };
    assert.equal(cls.matches[0]!.workflowId, 'design-conformance');
    assert.deepEqual(cls.matches[0]!.missing, ['target']);
    const resolved = (await call(fx, 'workflows', { action: 'resolve', id: 'design-conformance', input: { target: 'src/kernel/state' } })) as { status: string; summary: string };
    assert.equal(resolved.status, 'runnable', resolved.summary);
    const started = (await call(fx, 'start_outcome', { workflowId: 'design-conformance', input: { target: 'src/kernel/state' } })) as { run: { id: string; state: string }; created: boolean };
    assert.equal(started.created, true);
    assert.equal(started.run.state, 'ready');
    const claimed = (await call(fx, 'claim_work', { runId: started.run.id, includeSkillBody: true })) as { work: { stepRunId: string; owner: string; token: number; step: { id: string }; skill: { id: string; body: string } } };
    assert.equal(claimed.work.step.id, 'gather');
    assert.equal(claimed.work.skill.id, 'context-mapping');
    assert.match(claimed.work.skill.body, /^---\nname: context-mapping/);
    const bad = (await call(fx, 'submit_work', { stepRunId: claimed.work.stepRunId, owner: claimed.work.owner, token: claimed.work.token, output: { principles: [] } })) as { step: { state: string }; validation: { ok: boolean }[] };
    assert.equal(bad.step.state, 'ready', 'no evidence: retried');
    const again = (await call(fx, 'claim_work', { runId: started.run.id })) as { work: { stepRunId: string; owner: string; token: number } };
    const ok = (await call(fx, 'submit_work', { stepRunId: again.work.stepRunId, owner: again.work.owner, token: again.work.token, output: { principles: ['keep the kernel host-agnostic'], targetSummary: 'the state module', unknownPrinciples: [] }, evidence: [{ ref: 'docs/design.md' }] })) as { step: { state: string } };
    assert.equal(ok.step.state, 'succeeded');
    assert.equal((await call(fx, 'submit_work', { stepRunId: again.work.stepRunId, owner: again.work.owner, token: again.work.token, output: {} }).catch((e: Error) => e.message)), `step ${again.work.stepRunId} is not held by this session under that token; claim it again`);
    const status = (await call(fx, 'run_status', { runId: started.run.id })) as { run: { state: string }; steps: { step: string; state: string }[] };
    assert.equal(status.run.state, 'running');
    assert.equal(status.steps.find((s) => s.step === 'gather')!.state, 'succeeded');
    assert.deepEqual(await call(fx, 'inbox'), []);
  } finally {
    fx.cleanup();
  }
});

test('the headless surface claims and submits but cannot decide, remember, or start', async () => {
  const fx = brokerFixture('headless');
  try {
    const boot = (await call(fx, 'bootstrap')) as { session: { executor: string }; capabilities: { maxTier: string } };
    assert.equal(boot.session.executor, 'runner:ci');
    assert.equal(boot.capabilities.maxTier, 'project_write');
    const claimed = (await call(fx, 'claim_step')) as { work: null; waitingOn: { kind: string } };
    assert.equal(claimed.work, null);
    assert.equal(claimed.waitingOn.kind, 'nothing_ready');
    for (const forbidden of HEADLESS_FORBIDDEN) assert.ok(!toolsFor('headless').some((t) => t.name === forbidden), forbidden);
    assert.equal((await call(fx, 'heartbeat', { stepRunId: 'x', token: 'not-the-lease' }).catch((e: Error) => e.message)), 'step x is not held by this session under that token');
  } finally {
    fx.cleanup();
  }
});
