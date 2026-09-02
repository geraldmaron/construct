/**
 * tests/kernel/broker/tools.test.ts — one definition per tool, closed input
 * schemas, two surfaces with the headless one unable to reach anything it
 * must not, and the interactive lifecycle from bootstrap to a final deliverable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, toolsFor, HEADLESS_FORBIDDEN } from '../../../src/kernel/broker/tools.ts';
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

test('bootstrap is small and says what to do next; answers create nothing; remember creates one statement', async () => {
  const fx = brokerFixture();
  try {
    const boot = (await call(fx, 'bootstrap')) as Record<string, unknown>;
    assert.ok(JSON.stringify(boot).length < 4000, 'bootstrap stays bounded');
    assert.deepEqual(Object.keys(boot).sort(), ['capabilities', 'construct', 'decisions', 'drift', 'next', 'profile', 'registry', 'runs', 'session', 'sources', 'tiers']);
    assert.equal((boot.registry as { skills: number }).skills, 17);
    assert.match(boot.next as string, /listen/);
    assert.equal(listActivity(fx.broker.store).length, 0, 'bootstrap records nothing');
    const cls = (await call(fx, 'classify_request', { text: 'What does this function do?' })) as { class: string };
    assert.equal(cls.class, 'answer');
    assert.equal(listActivity(fx.broker.store).length, 0, 'classifying records nothing');
    const remembered = (await call(fx, 'remember', { kind: 'decision', text: 'We will not add schema migration until stable.' })) as { remembered: { id: string }; nothingElseCreated: boolean };
    assert.equal(remembered.nothingElseCreated, true);
    assert.equal(listStatements(fx.broker.store).filter((s) => s.kind === 'decision').length, 1);
    assert.equal((await call(fx, 'run_status', { runId: 'nope' }).catch((e: Error) => e.message)), 'no run nope');
    const ctxRead = (await call(fx, 'project_context', { topic: 'statements', query: 'migration' })) as unknown[];
    assert.equal(ctxRead.length, 1);
  } finally {
    fx.cleanup();
  }
});

test('the interactive lifecycle: classify, start, claim, submit, status, promote', async () => {
  const fx = brokerFixture();
  try {
    const cls = (await call(fx, 'classify_request', { text: 'Review this feature against the project’s design principles' })) as { class: string; suggestedWorkflows: { id: string }[] };
    assert.equal(cls.class, 'manage');
    assert.ok(cls.suggestedWorkflows.some((w) => w.id === 'design-conformance'));
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
    assert.equal((await call(fx, 'submit_work', { stepRunId: again.work.stepRunId, owner: again.work.owner, token: again.work.token, output: {} }).catch((e: Error) => e.message)), `step ${again.work.stepRunId} is not held under this owner and token; claim it again`);
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
    assert.equal((await call(fx, 'heartbeat', { stepRunId: 'x', owner: 'runner:ci', token: 1 }).catch((e: Error) => e.message)), 'step x is not held under this owner and token');
  } finally {
    fx.cleanup();
  }
});
