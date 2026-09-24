/**
 * tests/security/authority.test.ts — only the person approves an action that
 * leaves the project or destroys something, and only the person accepts or
 * finalizes a deliverable. A model relaying their words, over MCP or by running
 * the command line through its shell tool, cannot; the decision stays open and
 * says how the person answers. An approval covers the executor it was given to:
 * another session claiming the step neither inherits it nor gets to stall it.
 * Every answer is recorded with who gave it and on which channel, so a relayed
 * answer is never on record as the person's.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listGrants } from '../../src/kernel/state/grants.ts';
import { getDecision, raiseDecision } from '../../src/kernel/state/decisions.ts';
import { listActivity } from '../../src/kernel/state/activity.ts';
import { addStatement, getStatement } from '../../src/kernel/state/profile.ts';
import { PersonChannelRequiredError } from '../../src/kernel/policy/channels.ts';
import { channelFor } from '../../src/cli/person-channel.ts';
import { toolsFor } from '../../src/kernel/broker/tools.ts';
import { mcpTool } from '../../src/kernel/broker/definition.ts';
import { join } from 'node:path';
import { openStateStore } from '../../src/kernel/state/open.ts';
import { run } from '../../src/cli/index.ts';
import { fixture } from '../kernel/workflow/support.ts';
import { brokerFixture } from '../kernel/broker/support.ts';
import { capture, inProject } from '../cli/support.ts';

/** Run `apply` to its gated external-write step and return the approval it raises. */
function pausedForApproval(fx: ReturnType<typeof fixture>, target = 'PROJ-14'): { runId: string; decisionId: string } {
  const started = fx.service.start({ workflowId: 'apply', input: { target }, trigger: 'manual' });
  const draft = fx.service.claimNext({ runId: started.run.id });
  fx.service.submit({ leased: draft.packet!.leased, output: { change: 'set status Done' } });
  const paused = fx.service.claimNext({ runId: started.run.id });
  assert.equal(paused.waitingOn?.kind, 'decision');
  return { runId: started.run.id, decisionId: (paused.waitingOn as { decision: { id: string } }).decision.id };
}

test('a relayed approval of an external write mints no grant and leaves the decision open', () => {
  const fx = fixture();
  try {
    const { decisionId } = pausedForApproval(fx);
    assert.throws(() => fx.service.decide({ decisionId, resolution: 'approve', by: 'model via claude-code', channel: 'relay' }), PersonChannelRequiredError);
    assert.throws(() => fx.service.decide({ decisionId, resolution: 'approve', by: 'model via claude-code' }), PersonChannelRequiredError, 'relay is the default');
    assert.equal(listGrants(fx.store).length, 0);
    assert.equal(getDecision(fx.store, decisionId)!.state, 'open');
    const person = fx.service.decide({ decisionId, resolution: 'approve', by: 'person via cli', channel: 'tty_cli' });
    assert.equal(person.decision.state, 'resolved');
    assert.equal(listGrants(fx.store).length, 1);
  } finally {
    fx.cleanup();
  }
});

test('a relay may still decline: declining only removes authority', () => {
  const fx = fixture();
  try {
    const { decisionId } = pausedForApproval(fx);
    const declined = fx.service.decide({ decisionId, resolution: 'decline', by: 'model via claude-code', channel: 'relay' });
    assert.equal(declined.decision.state, 'resolved');
    assert.equal(listGrants(fx.store).length, 0);
  } finally {
    fx.cleanup();
  }
});

test('an approval covers the executor it was given to; another claimer neither inherits nor stalls it', () => {
  const fx = fixture();
  try {
    const { runId, decisionId } = pausedForApproval(fx);
    fx.service.decide({ decisionId, resolution: 'approve', by: 'person via cli', channel: 'tty_cli' });
    const intruder = fx.service.claimNext({ runId, owner: 'session:other' });
    assert.equal(intruder.packet, null, 'the approved step is not handed to a different session');
    assert.equal(intruder.waitingOn?.kind, 'held', 'it waits for the approved session, and no new question is raised in front of the person');
    const approved = fx.service.claimNext({ runId });
    assert.equal(approved.packet!.step.id, 'push', 'the session the person approved still gets its step');
  } finally {
    fx.cleanup();
  }
});

test('the MCP decide tool relays: it reports that the person must answer, and nothing is granted', async () => {
  const fx = brokerFixture();
  try {
    const decision = raiseDecision(fx.broker.store, {
      id: 'decision-ext',
      kind: 'approval',
      question: 'Approve exactly this: push PROJ-14',
      options: ['approve', 'decline'],
      subject: { request: { tier: 'external_write', targetSystem: 'jira', targetResource: 'PROJ-14', operation: 'push PROJ-14', executorId: 'session:claude-code' } },
      at: fx.broker.now(),
    });
    const decide = toolsFor('interactive').find((t) => t.name === 'decide')!;
    const result = (await decide.run(fx.broker, { decisionId: decision.id, resolution: 'approve' })) as { personRequired?: boolean; decision: { state: string }; next?: string };
    assert.equal(result.personRequired, true);
    assert.equal(result.decision.state, 'open');
    assert.match(result.next ?? '', /construct inbox resolve decision-ext/);
    assert.equal(listGrants(fx.broker.store).length, 0);
  } finally {
    fx.cleanup();
  }
});

test('the command line is a person channel only on a terminal with no agent host around it', () => {
  const none = {} as NodeJS.ProcessEnv;
  assert.equal(channelFor(none, { interactive: true, agentAncestor: null }), 'tty_cli');
  assert.equal(channelFor(none, { interactive: false, agentAncestor: null }), 'relay', 'no terminal: a shell tool, a pipe, CI');
  assert.equal(channelFor(none, { interactive: true, agentAncestor: '/Applications/Claude.app/Contents/MacOS/claude' }), 'relay', 'a terminal pane the host controls');
  assert.equal(channelFor({ CLAUDECODE: '1' } as NodeJS.ProcessEnv, { interactive: true, agentAncestor: null }), 'relay', 'launched by an agent host');
  assert.equal(channelFor({ CURSOR_AGENT: '1' } as NodeJS.ProcessEnv, { interactive: true, agentAncestor: null }), 'relay');
});

test('tools that mint approvals, settle trust, or close work say so to the host', () => {
  const byName = new Map(toolsFor('interactive').map((t) => [t.name, mcpTool(t) as { annotations: { destructiveHint: boolean; readOnlyHint: boolean } }]));
  for (const name of ['decide', 'promote_deliverable', 'work']) assert.equal(byName.get(name)!.annotations.destructiveHint, true, name);
  for (const [name, tool] of byName) if (tool.annotations.readOnlyHint) assert.equal(tool.annotations.destructiveHint, false, name);
});

test('a workflow whose first step needs approval pauses cleanly and surfaces the question on every claim', () => {
  const fx = fixture();
  try {
    const started = fx.service.start({ workflowId: 'direct', input: { target: 'PROJ-9' }, trigger: 'manual' });
    const first = fx.service.claimNext({ runId: started.run.id });
    assert.equal(first.waitingOn?.kind, 'decision');
    assert.equal(fx.service.status(started.run.id)!.run.state, 'waiting_for_decision');
    const again = fx.service.claimNext({ runId: started.run.id });
    assert.equal(again.waitingOn?.kind, 'decision', 'a later claim still names the open question, not nothing_ready');
  } finally {
    fx.cleanup();
  }
});

test('an answer relayed over MCP is recorded as relayed through its host, never as the person', async () => {
  const fx = brokerFixture();
  try {
    const decision = raiseDecision(fx.broker.store, {
      id: 'decision-relayed',
      kind: 'approval',
      question: 'Approve exactly this: push PROJ-14',
      options: ['approve', 'decline'],
      subject: { request: { tier: 'external_write', targetSystem: 'jira', targetResource: 'PROJ-14', operation: 'push PROJ-14', executorId: 'session:claude-code' } },
      at: fx.broker.now(),
    });
    const decide = toolsFor('interactive').find((t) => t.name === 'decide')!;
    const result = (await decide.run(fx.broker, { decisionId: decision.id, resolution: 'decline' })) as { decision: { state: string; resolvedBy: string } };
    assert.equal(result.decision.state, 'resolved');
    assert.match(result.decision.resolvedBy, /^relayed via claude-code$/);
    assert.match(getDecision(fx.broker.store, decision.id)!.resolvedBy!, /^relayed via /);
    const resolved = listActivity(fx.broker.store).find((e) => e.kind === 'decision.resolved' && (e.payload as { decisionId: string }).decisionId === decision.id)!;
    assert.equal(resolved.actor, 'relayed via claude-code');
    assert.equal((resolved.payload as { channel: string }).channel, 'relay');

    // A proposed statement confirmed through the relay is confirmed, and the record says it was relayed.
    const proposed = addStatement(fx.broker.store, { id: 'st-proposed', kind: 'principle', text: 'Keep the kernel host-agnostic', provenance: 'discovery', at: fx.broker.now() });
    assert.equal(proposed.status, 'proposed');
    const confirmed = (await decide.run(fx.broker, { decisionId: proposed.id, resolution: 'confirm' })) as { decision: { resolvedBy: string }; statement: { status: string } };
    assert.equal(confirmed.statement.status, 'confirmed');
    assert.match(confirmed.decision.resolvedBy, /^relayed via /);
    assert.equal(getStatement(fx.broker.store, proposed.id)!.status, 'confirmed');
    const row = listActivity(fx.broker.store).find((e) => e.kind === 'proposal.resolved')!;
    assert.equal(row.actor, 'relayed via claude-code');
    assert.deepEqual(row.payload, { statementId: proposed.id, kind: 'principle', status: 'confirmed', channel: 'relay' });
  } finally {
    fx.cleanup();
  }
});

test('a person-channel answer carries its channel into the activity record', () => {
  const fx = fixture();
  try {
    const { decisionId } = pausedForApproval(fx);
    fx.service.decide({ decisionId, resolution: 'approve', by: 'person via cli', channel: 'tty_cli' });
    const resolved = listActivity(fx.store).find((e) => e.kind === 'decision.resolved')!;
    assert.equal(resolved.actor, 'person via cli');
    assert.equal((resolved.payload as { channel: string }).channel, 'tty_cli');
  } finally {
    fx.cleanup();
  }
});

test('the person accepts and finalizes a deliverable on their own channel; a relay can do neither', () => {
  const fx = fixture();
  try {
    const started = fx.service.start({ workflowId: 'ship', input: { request: 'Rename a private helper in the invoice formatter' }, trigger: 'manual' });
    const claimed = fx.service.claimNext({ runId: started.run.id });
    const done = fx.service.submit({ leased: claimed.packet!.leased, output: { summary: 'renamed the helper', findings: [] } });
    const deliverableId = done.deliverable!.id;
    assert.equal(done.deliverable!.trustState, 'validated');

    for (const to of ['accepted', 'final'] as const) {
      assert.throws(() => fx.service.promote({ deliverableId, to, by: 'relayed via claude-code', channel: 'relay' }), PersonChannelRequiredError, `relay to ${to}`);
      assert.throws(() => fx.service.promote({ deliverableId, to, by: 'relayed via claude-code' }), PersonChannelRequiredError, `relay is the default, to ${to}`);
    }

    const asked = fx.service.requestPromotion({ deliverableId, to: 'accepted', by: 'relayed via claude-code', reason: 'the session asks the person to accept' });
    assert.equal(asked.kind, 'approval');
    assert.equal(fx.service.requestPromotion({ deliverableId, to: 'accepted', by: 'relayed via claude-code' }).id, asked.id, 'one open question, not one per ask');
    assert.throws(() => fx.service.decide({ decisionId: asked.id, resolution: 'approve', by: 'relayed via claude-code', channel: 'relay' }), PersonChannelRequiredError);
    assert.equal(fx.service.status(started.run.id)!.deliverables.find((d) => d.id === deliverableId)!.trustState, 'validated', 'a relayed approval moves nothing');
    assert.equal(getDecision(fx.store, asked.id)!.state, 'open');

    const accepted = fx.service.decide({ decisionId: asked.id, resolution: 'approve', by: 'person via cli', channel: 'tty_cli' });
    assert.equal(accepted.decision.state, 'resolved');
    assert.equal(fx.service.status(started.run.id)!.deliverables.find((d) => d.id === deliverableId)!.trustState, 'accepted');

    assert.throws(() => fx.service.promote({ deliverableId, to: 'final', by: 'relayed via claude-code', channel: 'relay' }), PersonChannelRequiredError);
    const final = fx.service.promote({ deliverableId, to: 'final', by: 'person via cli', channel: 'tty_cli' });
    assert.equal(final.trustState, 'final');
  } finally {
    fx.cleanup();
  }
});

test('a relayed approval of a destructive action mints nothing and leaves the step waiting for the person', () => {
  const fx = fixture({ maxTier: 'destructive' });
  try {
    const started = fx.service.start({ workflowId: 'raze', input: { target: 'PROJ-99' }, trigger: 'manual' });
    const asked = fx.service.claimNext({ runId: started.run.id });
    assert.equal(asked.waitingOn?.kind, 'decision');
    const decision = (asked.waitingOn as { decision: { id: string; subject: { request: { tier: string } } } }).decision;
    assert.equal(decision.subject.request.tier, 'destructive');
    assert.throws(() => fx.service.decide({ decisionId: decision.id, resolution: 'approve', by: 'relayed via claude-code', channel: 'relay' }), PersonChannelRequiredError);
    assert.equal(listGrants(fx.store).length, 0);
    assert.equal(getDecision(fx.store, decision.id)!.state, 'open');
    assert.equal(fx.service.claimNext({ runId: started.run.id }).waitingOn?.kind, 'decision', 'the step still waits on the person');

    fx.service.decide({ decisionId: decision.id, resolution: 'approve', by: 'person via cli', channel: 'tty_cli' });
    assert.equal(listGrants(fx.store).length, 1);
    assert.equal(fx.service.claimNext({ runId: started.run.id }).packet?.step.id, 'drop');
  } finally {
    fx.cleanup();
  }
});

test('inbox resolve approves only from a terminal of the person’s own', async () => {
  await inProject(async (ctx, box) => {
    const store = openStateStore(join(box.cwd, '.construct', 'state', 'construct.sqlite'));
    try {
      raiseDecision(store, {
        id: 'decision-cli',
        kind: 'approval',
        question: 'Approve exactly this: push PROJ-14',
        options: ['approve', 'decline'],
        subject: { request: { tier: 'external_write', targetSystem: 'jira', targetResource: 'PROJ-14', operation: 'push PROJ-14', executorId: 'session:claude-code' } },
        at: ctx.now(),
      });
      addStatement(store, { id: 'st-cli-proposed', kind: 'principle', text: 'Keep the kernel host-agnostic', provenance: 'discovery', at: ctx.now() });
    } finally {
      store.close();
    }

    const shellTool = { ...ctx, terminal: { interactive: false, agentAncestor: null } };
    const refused = await capture(() => run(['inbox', 'resolve', 'decision-cli', 'approve'], shellTool));
    assert.equal(refused.code, 1);
    assert.match(refused.err, /decision-cli needs your own answer, and this command is not running in a terminal of yours/);
    assert.match(refused.err, /next: Run the same command yourself in a terminal outside your agent host/);

    const proposal = await capture(() => run(['inbox', 'resolve', 'st-cli-proposed', 'confirm'], shellTool));
    assert.equal(proposal.code, 0, proposal.err);

    const person = { ...ctx, terminal: { interactive: true, agentAncestor: null } };
    const approved = await capture(() => run(['inbox', 'resolve', 'decision-cli', 'approve'], person));
    assert.equal(approved.code, 0, approved.err);
    assert.match(approved.out, /recorded: decision-cli → approve/);

    const after = openStateStore(join(box.cwd, '.construct', 'state', 'construct.sqlite'), { readOnly: true });
    try {
      assert.equal(getDecision(after, 'decision-cli')!.resolvedBy, 'person via cli');
      assert.equal(listGrants(after).length, 1);
      const events = listActivity(after);
      const resolved = events.find((e) => e.kind === 'decision.resolved' && (e.payload as { decisionId: string }).decisionId === 'decision-cli')!;
      assert.equal((resolved.payload as { channel: string }).channel, 'tty_cli');
      const confirmed = events.find((e) => e.kind === 'proposal.resolved')!;
      assert.equal(confirmed.actor, 'relayed via cli (no person at a terminal)');
      assert.equal((confirmed.payload as { channel: string }).channel, 'relay');
    } finally {
      after.close();
    }
  });
});
