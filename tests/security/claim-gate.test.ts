/**
 * tests/security/claim-gate.test.ts — a claimer leases only a step the gate
 * cleared for it, in the same write transaction; a step approved for another
 * session waits for that session only while its grant stands, and never
 * blocks the run's other steps; and a claimer never leases a step above its
 * tier or beyond its capabilities.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listGrants } from '../../src/kernel/state/grants.ts';
import { getStep, listSteps } from '../../src/kernel/state/steps.ts';
import { listOpenDecisions } from '../../src/kernel/state/decisions.ts';
import { DEFAULT_APPROVAL_TTL_MS, type ActionRequest } from '../../src/kernel/policy/engine.ts';
import { bindingFor } from '../../src/cli/broker-context.ts';
import { UsageError } from '../../src/cli/output.ts';
import { run } from '../../src/cli/index.ts';
import { fixture } from '../kernel/workflow/support.ts';
import { capture, sandbox } from '../cli/support.ts';

test('a step another session makes ready mid-claim is never leased ungated', () => {
  const fx = fixture();
  const other = fx.peer({ busyTimeoutMs: 0 });
  try {
    const started = fx.service.start({ workflowId: 'fork', input: { target: 'PROJ-7' }, trigger: 'manual' });
    const mine = other.service.claimNext({ runId: started.run.id, owner: 'session:A' });
    assert.equal(mine.packet!.step.id, 'a');

    // Session A finishes `a` while session B is between gating and leasing,
    // which makes the external write `b` ready at a lower ordinal than `c`.
    let interleaved: 'landed' | 'held off' | null = null;
    fx.onSkillLookup = () => {
      fx.onSkillLookup = null;
      try {
        other.service.submit({ leased: mine.packet!.leased, output: { change: 'set status Done' } });
        interleaved = 'landed';
      } catch {
        interleaved = 'held off';
      }
    };
    const b = fx.service.claimNext({ runId: started.run.id, owner: 'session:B' });
    assert.equal(b.packet?.step.id, 'c', 'B leases the step its gate cleared, never the external write');
    assert.equal(interleaved, 'held off', 'no other session writes between the gate and the lease');

    // A's write lands once B's claim has committed; B is then asked, not handed the step.
    other.service.submit({ leased: mine.packet!.leased, output: { change: 'set status Done' } });
    const next = fx.service.claimNext({ runId: started.run.id, owner: 'session:B' });
    assert.equal(next.waitingOn?.kind, 'decision');
    const push = listSteps(fx.store, started.run.id).find((s) => s.stepId === 'b')!;
    assert.notEqual(getStep(fx.store, push.id)!.leaseOwner, 'session:B');
    assert.equal(listGrants(fx.store).length, 0, 'nothing was approved, so nothing may act at external_write');
  } finally {
    other.close();
    fx.cleanup();
  }
});

/** Start `twin`, have the session ask, and have the person approve its external write. */
function approvedForA(fx: ReturnType<typeof fixture>): { runId: string; approvalEnds: string } {
  const started = fx.service.start({ workflowId: 'twin', input: { target: 'PROJ-3' }, trigger: 'manual' });
  const asked = fx.service.claimNext({ runId: started.run.id });
  assert.equal(asked.waitingOn?.kind, 'decision');
  const decisionId = (asked.waitingOn as { decision: { id: string } }).decision.id;
  fx.service.decide({ decisionId, resolution: 'approve', by: 'person via cli', channel: 'tty_cli' });
  return { runId: started.run.id, approvalEnds: listGrants(fx.store)[0]!.endsAt! };
}

test('a step approved for another session is held only for that step, and says for whom and until when', () => {
  const fx = fixture();
  try {
    const { runId, approvalEnds } = approvedForA(fx);
    const other = fx.service.claimNext({ runId, owner: 'session:B' });
    assert.equal(other.packet?.step.id, 'right', 'the run’s other ready step stays claimable');
    const held = fx.service.claimNext({ runId, owner: 'session:B' });
    assert.equal(held.packet, null);
    assert.deepEqual(held.waitingOn, { kind: 'held', runId, stepId: 'left', executorId: fx.host.executorId, until: approvalEnds });
    assert.equal(listOpenDecisions(fx.store, runId).length, 0, 'no new question is put in front of the person');
    const approved = fx.service.claimNext({ runId });
    assert.equal(approved.packet?.step.id, 'left', 'the approved session still gets its step');
  } finally {
    fx.cleanup();
  }
});

test('once the approved session’s grant lapses, another claimer is asked afresh instead of waiting forever', () => {
  const fx = fixture();
  try {
    const { runId } = approvedForA(fx);
    fx.tick(DEFAULT_APPROVAL_TTL_MS + 1000);
    const after = fx.service.claimNext({ runId, owner: 'session:B' });
    assert.equal(after.waitingOn?.kind, 'decision');
    const fresh = (after.waitingOn as { decision: { kind: string; subject: { request: ActionRequest } } }).decision;
    assert.equal(fresh.kind, 'approval');
    assert.equal(fresh.subject.request.executorId, 'session:B', 'the question is about the session that will act');
  } finally {
    fx.cleanup();
  }
});

test('a claimer never leases a step above its tier or beyond its capabilities', () => {
  const fx = fixture();
  const runner = fx.peer({ host: { executorId: 'runner:nightly', sessionId: null, maxTier: 'project_write' } });
  const narrow = fx.peer({ host: { executorId: 'session:narrow', available: new Set(['read_project_context', 'model_review']) } });
  try {
    const started = fx.service.start({ workflowId: 'apply', input: { target: 'PROJ-21' }, trigger: 'manual' });
    const draft = runner.service.claimNext({ runId: started.run.id });
    assert.equal(draft.packet?.step.id, 'draft', 'a step within reach is leased as before');
    runner.service.submit({ leased: draft.packet!.leased, output: { change: 'set status Done' } });

    const tooHigh = runner.service.claimNext({ runId: started.run.id });
    assert.equal(tooHigh.packet, null);
    assert.equal(tooHigh.waitingOn?.kind, 'refused');
    assert.match((tooHigh.waitingOn as { reason: string }).reason, /push acts at external_write; this executor may reach project_write at most/);

    const lacking = narrow.service.claimNext({ runId: started.run.id });
    assert.equal(lacking.waitingOn?.kind, 'refused');
    assert.match((lacking.waitingOn as { reason: string }).reason, /push needs write_source:jira/);
    assert.equal(listOpenDecisions(fx.store, started.run.id).length, 0, 'a claimer that cannot act raises no question for the person');

    const able = fx.service.claimNext({ runId: started.run.id });
    assert.equal(able.waitingOn?.kind, 'decision', 'a session able to act is asked as before');
  } finally {
    runner.close();
    narrow.close();
    fx.cleanup();
  }
});

test('a headless runner cannot take an interactive session’s executor id', async () => {
  const box = sandbox();
  try {
    assert.throws(() => bindingFor(box.ctx, { headless: true, executor: 'session:claude-code:4242' }), UsageError);
    assert.equal(bindingFor(box.ctx, { headless: true, executor: 'runner:nightly' }).executorId, 'runner:nightly');
    const refused = await capture(() => run(['serve', '--headless', '--executor=session:claude-code:4242', '--describe'], box.ctx));
    assert.equal(refused.code, 2);
    assert.match(refused.err, /names an interactive session/);
  } finally {
    box.cleanup();
  }
});
