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
const OUTCOME = 'Handle GDPR data subject requests for EU customers';

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
