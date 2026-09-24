/**
 * tests/security/authority.test.ts — only the person approves an action that
 * leaves the project or destroys something, and only the person accepts or
 * finalizes a deliverable. A model relaying their words, over MCP or by running
 * the command line through its shell tool, cannot; the decision stays open and
 * says how the person answers. An approval covers the executor it was given to:
 * another session claiming the step neither inherits it nor gets to stall it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listGrants } from '../../src/kernel/state/grants.ts';
import { getDecision, raiseDecision } from '../../src/kernel/state/decisions.ts';
import { PersonChannelRequiredError } from '../../src/kernel/policy/channels.ts';
import { channelFor } from '../../src/cli/person-channel.ts';
import { toolsFor } from '../../src/kernel/broker/tools.ts';
import { mcpTool } from '../../src/kernel/broker/definition.ts';
import { fixture } from '../kernel/workflow/support.ts';
import { brokerFixture } from '../kernel/broker/support.ts';

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
    assert.notEqual(intruder.waitingOn?.kind, 'decision', 'and no new question is raised in front of the person');
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
