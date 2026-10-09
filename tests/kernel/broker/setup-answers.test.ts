/**
 * tests/kernel/broker/setup-answers.test.ts — the decide tool answers a setup
 * question into the profile and says what setup still needs. A relayed side
 * project is put to the person, who may give it on their own; otherwise the
 * question stays open with the command they run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { record } from '../../../src/kernel/broker/definition.ts';
import type { BrokerContext } from '../../../src/kernel/broker/context.ts';
import type { AskPerson } from '../../../src/kernel/policy/channels.ts';
import { getDecision, raiseDecision } from '../../../src/kernel/state/decisions.ts';
import { getProfile } from '../../../src/kernel/state/profile.ts';
import { ONBOARDING_QUESTIONS, SCALE_OPTIONS } from '../../../src/kernel/project/discovery.ts';
import { brokerFixture } from './support.ts';

type Fixture = ReturnType<typeof brokerFixture>;

async function call(fx: Fixture, name: string, args: Record<string, unknown>, ctx: BrokerContext = fx.broker): Promise<any> {
  const t = TOOLS.find((x) => x.name === name)!;
  return t.run(ctx, t.validate(record(args)));
}

function askScale(fx: Fixture, id: string): void {
  raiseDecision(fx.broker.store, { id, kind: 'clarification', question: ONBOARDING_QUESTIONS[0]!.question, options: SCALE_OPTIONS, subject: { onboarding: 'scale' }, at: fx.broker.now() });
}

test('a relayed scale in the question\'s words lands in the profile, and the reply says what setup still needs', async () => {
  const fx = brokerFixture();
  try {
    askScale(fx, 'q-scale');
    const r = await call(fx, 'decide', { decisionId: 'q-scale', resolution: 'a team project' });
    assert.deepEqual(r.decision, { id: 'q-scale', state: 'resolved', resolvedBy: 'relayed via claude-code' });
    assert.equal(r.run, null);
    assert.deepEqual(r.profile, { onboarding: 'incomplete', missing: ['purpose', 'primaryOutcome'] });
    assert.equal(getProfile(fx.broker.store)!.scale, 'team');
    assert.equal(getDecision(fx.broker.store, 'q-scale')!.resolution, 'team');
  } finally {
    fx.cleanup();
  }
});

test('a relayed side project waits for the person, who is told the command, and nothing lowers the work meanwhile', async () => {
  const fx = brokerFixture();
  try {
    askScale(fx, 'q-scale');
    const r = await call(fx, 'decide', { decisionId: 'q-scale', resolution: 'side project' });
    assert.equal(r.personRequired, true);
    assert.deepEqual(r.decision, { id: 'q-scale', state: 'open' });
    assert.match(r.next, /side project, which lowers how much challenge work gets, needs the person/);
    assert.match(r.next, /`construct inbox resolve q-scale side_project`/);
    assert.ok(r.profile.missing.includes('scale'));
    assert.equal(getProfile(fx.broker.store)?.scale ?? null, null);

    const closed: AskPerson = async () => ({ answered: false, why: 'cancelled' });
    const unanswered = await call(fx, 'decide', { decisionId: 'q-scale', resolution: 'side_project' }, { ...fx.broker, askPerson: closed } as BrokerContext);
    assert.equal(unanswered.asked, 'the person closed the prompt');
    assert.match(unanswered.next, /`construct inbox resolve q-scale side_project`/, 'the person is told the answer they would give, not approve or decline');
    assert.equal(getDecision(fx.broker.store, 'q-scale')!.state, 'open');
  } finally {
    fx.cleanup();
  }
});

test('when the host can ask, the person\'s own choice of side project makes the project one', async () => {
  const fx = brokerFixture();
  try {
    askScale(fx, 'q-scale');
    const asked: { message: string; options: readonly string[] }[] = [];
    const pick: AskPerson = async (q) => { asked.push(q); return { answered: true, choice: 'side_project' }; };
    const r = await call(fx, 'decide', { decisionId: 'q-scale', resolution: 'it is a side project' }, { ...fx.broker, askPerson: pick } as BrokerContext);
    assert.equal(asked.length, 1);
    assert.match(asked[0]!.message, /^Construct needs your own answer; your assistant cannot give it for you\. What is this project to you:/);
    assert.match(asked[0]!.message, /\nYour assistant relayed .*it is a side project.*\.$/);
    assert.deepEqual(asked[0]!.options, SCALE_OPTIONS);
    assert.equal(r.channel, 'elicitation');
    assert.equal(r.decision.state, 'resolved');
    assert.ok(!r.profile.missing.includes('scale'));
    assert.equal(getProfile(fx.broker.store)!.scale, 'side_project');
    assert.equal(getDecision(fx.broker.store, 'q-scale')!.channel, 'elicitation');
  } finally {
    fx.cleanup();
  }
});
