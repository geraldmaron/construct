/**
 * tests/kernel/run/spine-challenges.test.ts — the challenges reach the path
 * people actually use.
 *
 * The challenge catalog was reachable only by a hand-written brief: everything
 * the spine produced declared nothing, so every deliverable came back at draft
 * with an empty outstanding list. That reads as "nothing is pending" and means
 * "nobody required anything", which is the worse of the two by far — the state
 * looks like a control that was never applied. A run in an isolated environment
 * made the cost concrete, returning confident statutory claims from a small
 * local model with nothing asking for a source.
 *
 * So these tests go through `startRun` and `workRun` rather than constructing a
 * brief, because a brief written by a test is exactly the thing that passed
 * while the real path did not.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import { getTask } from '../../../src/kernel/store/tasks.ts';
import { addSource, recordSourceRead } from '../../../src/kernel/store/sources.ts';
import { enqueueTask } from '../../../src/kernel/store/tasks.ts';
import { openDecisions, resolveDecision } from '../../../src/kernel/store/decisions.ts';
import { readWorkLog } from '../../../src/kernel/store/worklog.ts';
import { startRun } from '../../../src/kernel/run/outcome.ts';
import { workRun, assignmentFor } from '../../../src/kernel/run/coordinator.ts';
import { promotionOf } from '../../../src/kernel/run/promotion.ts';
import { SPINE_CHALLENGES, challengeById } from '../../../src/kernel/challenge/catalog.ts';
import { appendWorkLog } from '../../../src/kernel/store/worklog.ts';
import { DRAFT_ACTION } from '../../../src/kernel/run/promotion.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';
import type { HostAdapter, HostResult } from '../../../src/kernel/hosts/interface.ts';

const AT = '2026-08-05T00:00:00.000Z';
// Low-tier on purpose: these tests exercise the structural challenge
// mechanics, and a high-tier run also declares challenges with no structural
// form, which hold promotion at draft regardless of what the checks find.
const OUTCOME = 'Add single sign-on login for the admin portal';

/** What the simulation actually produced: sourced-sounding, sourced by nothing. */
const UNSOURCED = [
  '# Privacy read',
  'Fines reach 4% of global annual turnover, and the rules applied from 2018-05-25.',
].join('\n');

/** The same work, cited and honest about what it did not cover. */
const SOURCED = [
  '# Privacy read',
  'A breach must be reported within 72 hours of awareness [cite:GDPR Article 33(1)].',
  '',
  '## Out of scope',
  'I could not determine where the data is processed, so transfers are uncovered.',
].join('\n');

function fixtureStore(): { store: ReturnType<typeof openStore>; done: () => void } {
  const fixture = sterile();
  const store = openStore(join(fixture.paths.dataDir, 'construct.db'));
  return {
    store,
    done: () => {
      store.close();
      fixture.cleanup();
    },
  };
}

function hostReturning(text: string): HostAdapter {
  return {
    name: 'fake',
    kind: 'general',
    capabilities: ['concurrent'],
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (task: { id: string }): Promise<HostResult> => ({
      id: task.id,
      status: 'ok',
      output: { text, usage: { cost: 0, steps: 1 } },
      error: null,
    }),
  } as unknown as HostAdapter;
}

test('a brief the spine produced declares the free challenges, and says so to the role', () => {
  const { store, done } = fixtureStore();
  try {
    const started = startRun(store, { runId: 'run-1', outcome: OUTCOME, at: AT });
    assert.ok(started.tasks.length > 0, 'the keyword map must implicate something here');

    for (const id of started.tasks) {
      const brief = getTask(store, id)?.brief as Brief;
      assert.deepEqual(brief.challenges, SPINE_CHALLENGES);
    }

    // Declared and stated: a role held to a challenge it was never shown is the
    // same failure in a different place.
    const assignment = assignmentFor(getTask(store, started.tasks[0])?.brief as Brief);
    for (const id of SPINE_CHALLENGES) {
      const challenge = challengeById(id);
      assert.ok(challenge, `${id} must exist in the catalog`);
      assert.ok(assignment.includes(challenge.question), `the role is told about ${id}`);
    }
  } finally {
    done();
  }
});

test('an unsourced deliverable is held at draft by the run itself, not by a hand-written brief', async () => {
  const { store, done } = fixtureStore();
  try {
    const started = startRun(store, { runId: 'run-1', outcome: OUTCOME, at: AT });
    await workRun(store, hostReturning(UNSOURCED), {
      owner: 'w1',
      clock: () => AT,
      spendCeiling: 100,
    });

    const promotion = promotionOf(store, started.tasks[0]);
    assert.ok(promotion);
    // Challenged and failing, never final. The state deliberately does not fall
    // back to draft, because "nobody challenged it" and "it was challenged and
    // failed" are the two things this whole fix exists to tell apart.
    assert.equal(promotion.state, 'challenged');
    assert.ok(promotion.failing.includes('claims-cited'));

    const verdicts = readWorkLog(store, 'run-1')
      .filter((e) => e.action === 'verdict-recorded')
      .map((e) => e.detail as { challenge: string; outcome: string; by: string });
    const cited = verdicts.find((v) => v.challenge === 'claims-cited');
    assert.ok(cited, 'the citation check ran on the real path');
    assert.equal(cited.outcome, 'failed');
    assert.equal(cited.by, 'construct:structural');
  } finally {
    done();
  }
});

test('a cited deliverable that names its gaps clears both, on the same path', async () => {
  const { store, done } = fixtureStore();
  try {
    const started = startRun(store, { runId: 'run-1', outcome: OUTCOME, at: AT });
    await workRun(store, hostReturning(SOURCED), {
      owner: 'w1',
      clock: () => AT,
      spendCeiling: 100,
    });

    const promotion = promotionOf(store, started.tasks[0]);
    assert.ok(promotion);
    assert.deepEqual(promotion.outstanding, []);
    assert.notEqual(promotion.state, 'draft');
    assert.deepEqual(promotion.waived, [], 'cleared by passing, not by setting aside');
  } finally {
    done();
  }
});

test('the challenges read the submitted draft, not the reply that summarizes it', async () => {
  const { store, done } = fixtureStore();
  try {
    const started = startRun(store, { runId: 'run-1', outcome: OUTCOME, at: AT });
    const task = started.tasks[0];

    // What a role with a write surface actually does, and is told to do: the
    // deliverable goes through submit_draft and the reply is a summary of it.
    const host = {
      ...hostReturning('Draft submitted.'),
      invoke: async (_request: unknown, ctx: { invocationId: string }) => {
        appendWorkLog(store, {
          run: 'run-1',
          task: ctx.invocationId,
          role: 'privacy',
          action: DRAFT_ACTION,
          detail: { deliverable: SOURCED },
          at: AT,
        });
        return { id: ctx.invocationId, status: 'ok', output: { text: 'Draft submitted.', usage: { cost: 0, steps: 1 } }, error: null };
      },
    } as unknown as HostAdapter;

    await workRun(store, host, { owner: 'w1', clock: () => AT, spendCeiling: 100 });

    // The reply alone shows no scope diff and would have failed. The draft does.
    const promotion = promotionOf(store, task);
    assert.ok(promotion);
    assert.deepEqual(promotion.failing, [], 'the verdict must be about the draft');
    assert.deepEqual(promotion.outstanding, []);
  } finally {
    done();
  }
});

/** Submit a draft of any shape, reply with a summary, as a real role does. */
function hostSubmitting(store: ReturnType<typeof openStore>, deliverable: unknown): HostAdapter {
  return {
    ...hostReturning('Draft submitted.'),
    invoke: async (_request: unknown, ctx: { invocationId: string }) => {
      appendWorkLog(store, {
        run: 'run-1',
        task: ctx.invocationId,
        role: 'privacy',
        action: DRAFT_ACTION,
        detail: { deliverable },
        at: AT,
      });
      return {
        id: ctx.invocationId,
        status: 'ok',
        output: { text: 'Draft submitted.', usage: { cost: 0, steps: 1 } },
        error: null,
      };
    },
  } as unknown as HostAdapter;
}

test('a draft that is not text is reported unreadable, and never passes a challenge', async () => {
  const { store, done } = fixtureStore();
  try {
    const started = startRun(store, { runId: 'run-1', outcome: OUTCOME, at: AT });

    // What the role actually sent on a real run: the challenge ids read as a
    // response schema. Coerced, this is the string "[object Object]", which the
    // citation check passes because it contains no amounts or dates.
    await workRun(
      store,
      hostSubmitting(store, {
        finding: 'Erasure requests need a route before launch.',
        'claims-cited': 'done',
        'scope-diff': 'done',
      }),
      { owner: 'w1', clock: () => AT, spendCeiling: 100 },
    );

    const verdicts = readWorkLog(store, 'run-1').filter((e) => e.action === 'verdict-recorded');
    assert.deepEqual(verdicts, [], 'nothing may be judged when nothing could be read');

    const unanswered = readWorkLog(store, 'run-1').filter(
      (e) => e.action === 'challenge-unanswered',
    );
    assert.ok(unanswered.length > 0, 'and the silence is on the record, not implied');
    const detail = unanswered[0].detail as { unanswered: Array<{ challenge: string; reason: string }> };
    assert.deepEqual(detail.unanswered.map((u) => u.challenge), [...SPINE_CHALLENGES]);
    assert.match(detail.unanswered[0].reason, /not readable as text/);

    // Draft is the state for "nobody answered these", which is exactly true.
    assert.equal(promotionOf(store, started.tasks[0])?.state, 'draft');
  } finally {
    done();
  }
});

test('a deliverable wearing a JSON envelope is unwrapped, not judged as a wrapper', async () => {
  const { store, done } = fixtureStore();
  try {
    const started = startRun(store, { runId: 'run-1', outcome: OUTCOME, at: AT });
    // Observed on a real run: a string whose whole content is {"deliverable": "..."}.
    await workRun(store, hostSubmitting(store, JSON.stringify({ deliverable: SOURCED })), {
      owner: 'w1',
      clock: () => AT,
      spendCeiling: 100,
    });

    const promotion = promotionOf(store, started.tasks[0]);
    assert.ok(promotion);
    assert.deepEqual(promotion.failing, [], 'the checks read the prose inside the wrapper');
    assert.deepEqual(promotion.outstanding, []);
  } finally {
    done();
  }
});

test('prose that merely opens with a brace is left alone', async () => {
  const { store, done } = fixtureStore();
  try {
    startRun(store, { runId: 'run-1', outcome: OUTCOME, at: AT });
    const prose = `{not json at all}\n${SOURCED}`;
    await workRun(store, hostSubmitting(store, prose), {
      owner: 'w1',
      clock: () => AT,
      spendCeiling: 100,
    });

    const verdicts = readWorkLog(store, 'run-1')
      .filter((e) => e.action === 'verdict-recorded')
      .map((e) => e.detail as { outcome: string });
    assert.ok(verdicts.length > 0);
    assert.ok(verdicts.every((v) => v.outcome === 'passed'));
  } finally {
    done();
  }
});

test('a high-tier run declares the conditional challenges; a low-tier run declares only the spine two', () => {
  const { store, done } = fixtureStore();
  try {
    const low = startRun(store, { runId: 'run-low', outcome: OUTCOME, at: AT });
    for (const id of low.tasks) {
      assert.deepEqual((getTask(store, id)?.brief as Brief).challenges, SPINE_CHALLENGES);
    }

    const high = startRun(store, {
      runId: 'run-high',
      outcome: 'Handle GDPR data subject requests for EU customers',
      at: AT,
    });
    assert.ok(high.tasks.length > 0, 'the keyword map must implicate something here');
    for (const id of high.tasks) {
      const brief = getTask(store, id)?.brief as Brief;
      // Every brief in a high-tier run carries the pre-mortem; the legal
      // issue-spot rides only on briefs whose own domain carries a
      // licensed-review marker.
      assert.ok(brief.challenges?.includes('pre-mortem'), `${id} declares pre-mortem`);
      if (brief.role === 'privacy') {
        assert.ok(brief.challenges?.includes('legal-issue-spot'), `${id} declares legal-issue-spot`);
      }
    }
  } finally {
    done();
  }
});

test('a grounded run cites its own ground and the citation gate accepts exactly that', async () => {
  const { store, done } = fixtureStore();
  try {
    const started = startRun(store, { runId: 'run-1', outcome: OUTCOME, at: AT });
    addSource(store, {
      id: 'src-1',
      workspace: 'default',
      kind: 'directory',
      locator: '/ground/repo',
      addedAt: AT,
    });
    recordSourceRead(store, {
      run: 'run-1',
      source: 'src-1',
      descriptor: '/ground/repo/docs/plan.md',
      coverage: 'complete',
      detail: '120 bytes',
      recordedAt: AT,
    });

    const GROUNDED = [
      '# Privacy read',
      'Sessions are minted in one module [cite:/ground/repo/src/auth/session.ts].',
      '',
      '## Out of scope',
      'I could not determine retention policy; it is uncovered.',
    ].join('\n');
    await workRun(store, hostReturning(GROUNDED), {
      owner: 'w1',
      clock: () => AT,
      spendCeiling: 100,
    });

    const verdicts = readWorkLog(store, 'run-1')
      .filter((e) => e.action === 'verdict-recorded')
      .map((e) => e.detail as { challenge: string; outcome: string });
    const cited = verdicts.filter((v) => v.challenge === 'claims-cited');
    assert.ok(cited.length > 0, 'the citation check ran');
    assert.ok(
      cited.every((v) => v.outcome === 'passed'),
      'code under the declared root is evidence on the real settle path',
    );

    // The same dispatch told the role about the license it is being judged by.
    const dispatches = readWorkLog(store, 'run-1').filter((e) => e.action === 'role-dispatched');
    assert.ok(dispatches.length > 0);
    void started;
  } finally {
    done();
  }
});

test('a role that lacks a user-held fact asks once through the inbox, and a later dispatch consumes the answer', async () => {
  const { store, done } = fixtureStore();
  try {
    // The EU-beta outcome on purpose: this scenario needs several roles so the
    // one-open-ask rule has something to suppress.
    const started = startRun(store, {
      runId: 'run-1',
      outcome: 'launch a paid beta to EU users next month',
      at: AT,
    });
    assert.ok(started.tasks.length >= 2, 'this scenario needs at least two roles');

    const ASKING = [
      '# Read',
      'Sessions expire after a fixed window [unverified].',
      '',
      '## Out of scope',
      'I could not determine the identity provider; it is uncovered.',
      '',
      'STANCE: proceed',
      'BECAUSE: nothing here blocks the outcome as stated.',
      'CITE: none',
      'ASK: Which identity provider does the organization standardize on?',
      'ASSUMING: the incumbent provider stays.',
    ].join('\n');

    await workRun(store, hostReturning(ASKING), {
      owner: 'w1',
      clock: () => AT,
      spendCeiling: 100,
    });

    // Every role asked; exactly one open ask reached the inbox.
    const open = openDecisions(store, 'run-1').filter((d) => d.id.endsWith(':ask'));
    assert.equal(open.length, 1, 'one open ask per run, never a questionnaire');
    assert.match(open[0].question, /needs a fact only you can give/);
    assert.equal(open[0].positions.length, 2);
    const suppressed = readWorkLog(store, 'run-1').filter(
      (e) => e.action === 'ask-suppressed-open-question',
    );
    assert.equal(suppressed.length, started.tasks.length - 1, 'the rest are on the log');

    // The user answers; a later dispatch of the run receives the answer.
    resolveDecision(store, open[0].id, 'We standardize on Okta.', AT);
    enqueueTask(store, {
      id: 't-later',
      run: 'run-1',
      role: 'privacy',
      brief: {
        id: 't-later',
        outcome: 'launch a paid beta to EU users next month',
        role: 'privacy',
        inputs: [],
        capabilities: [],
        postconditions: [],
      },
      at: AT,
    });
    const assignments: string[] = [];
    const capturing: HostAdapter = {
      ...hostReturning(SOURCED),
      invoke: async (request: unknown): Promise<HostResult> => {
        assignments.push((request as { task: string }).task);
        return { id: 't-later', status: 'ok', output: { text: SOURCED, usage: { cost: 0, steps: 1 } }, error: null };
      },
    } as unknown as HostAdapter;
    await workRun(store, capturing, { owner: 'w2', clock: () => AT, spendCeiling: 100 });

    assert.equal(assignments.length, 1);
    assert.match(assignments[0], /already answered these questions/);
    assert.match(assignments[0], /We standardize on Okta\./);
    assert.match(assignments[0], /ASK: <the question, one sentence>/, 'the protocol itself is stated');
  } finally {
    done();
  }
});
