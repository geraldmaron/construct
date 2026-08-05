/**
 * tests/kernel/run/promotion.test.ts — the enforcement promotion.ts exists
 * for: a role cannot advance its own promotion state, by any route it holds,
 * and every attempt lands on the record.
 *
 * Written against the real store rather than a stub. The guarantee is partly a
 * storage property — the work log is append-only because triggers say so — and a
 * stub that accepted writes the database would refuse would prove the opposite
 * of what this file claims.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import type { Store } from '../../../src/kernel/store/open.ts';
import { enqueueTask } from '../../../src/kernel/store/tasks.ts';
import { readWorkLog } from '../../../src/kernel/store/worklog.ts';
import { issueRoleToken } from '../../../src/kernel/capabilities/tokens.ts';
import {
  CAPABILITY_DENIED_ACTION,
  ROLE_ACTION_PREFIX,
  appendAsRole,
  submitDraft,
} from '../../../src/kernel/run/rolewrite.ts';
import {
  DRAFT_ACTION,
  PROMOTION_ACTION,
  VERDICT_ACTION,
  VERDICT_REFUSED_ACTION,
  latestDraft,
  logPromotion,
  promotionOf,
  recordVerdict,
} from '../../../src/kernel/run/promotion.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';

const SECRET = 'kernel-secret-for-tests';
const AT = '2026-08-04T00:00:00.000Z';
const EXPIRES = '2026-08-04T00:15:00.000Z';
const RUN = 'run-1';
const TASK = 't-privacy';
const CHALLENGES = ['strongest-objection', 'scope-diff'];

function withStore<T>(fn: (store: Store) => T): T {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    return fn(store);
  } finally {
    store.close();
    fixture.cleanup();
  }
}

function brief(role: string, challenges: readonly string[] = CHALLENGES): Brief {
  return {
    id: `t-${role}`,
    outcome: 'launch a paid beta to EU users next month',
    role,
    inputs: [],
    capabilities: [],
    postconditions: [],
    challenges,
  };
}

function seed(store: Store): void {
  enqueueTask(store, { id: TASK, run: RUN, role: 'privacy', brief: brief('privacy'), at: AT });
  enqueueTask(store, {
    id: 't-security',
    run: RUN,
    role: 'security',
    brief: brief('security'),
    at: AT,
  });
}

function roleToken(task = TASK, role = 'privacy'): string {
  return issueRoleToken({ run: RUN, task, role, expiresAt: EXPIRES, nonce: '1' }, SECRET);
}

function credential(token: unknown = roleToken(), at = AT) {
  return { token, secret: SECRET, at };
}

function actions(store: Store): string[] {
  return readWorkLog(store, RUN).map((entry) => entry.action);
}

test('a resubmission is told to stop, the cap closes the window, and the log records the cap once', () => {
  withStore((store) => {
    seed(store);
    const submit = () =>
      submitDraft(store, credential(), { run: RUN, task: TASK, deliverable: { text: 'a draft' } });

    const first = submit();
    assert.equal(first.ok, true);
    assert.equal('note' in first && first.note !== undefined, false, 'a first draft needs no warning');

    const second = submit();
    assert.equal(second.ok, true);
    assert.match(
      (second as { note?: string }).note ?? '',
      /stop now/,
      'a superseding draft is told stopping is the next move',
    );

    submit();
    submit();
    const fifth = submit();
    assert.equal(fifth.ok, true);

    // The loop observed live: the role keeps going. Every attempt past the cap
    // is refused with a stop message, and the record shows the window closed
    // once — not the shape of the loop that kept hitting it.
    for (let i = 0; i < 3; i += 1) {
      const over = submit();
      assert.equal(over.ok, false);
      assert.equal((over as { denial: string }).denial, 'draft-cap');
      assert.match((over as { reason: string }).reason, /Stop now/);
    }
    const all = actions(store);
    assert.equal(all.filter((a) => a === 'draft-submitted').length, 5, 'the cap held');
    assert.equal(all.filter((a) => a === 'draft-cap-reached').length, 1, 'the cap logged once');
  });
});

test('a role submits drafts and appends to its log, and moves nothing', () => {
  withStore((store) => {
    seed(store);

    const draft = submitDraft(store, credential(), {
      run: RUN,
      task: TASK,
      deliverable: { text: 'first pass at the privacy read' },
    });
    assert.equal(draft.ok, true);

    const note = appendAsRole(store, credential(), {
      run: RUN,
      task: TASK,
      action: 'reviewed-dpa',
      detail: { pages: 4 },
    });
    assert.equal(note.ok, true);

    const entries = readWorkLog(store, RUN);
    assert.equal(entries[0].action, DRAFT_ACTION);
    assert.equal(entries[0].role, 'privacy', 'a role writes in its own name');
    assert.equal(entries[1].action, `${ROLE_ACTION_PREFIX}reviewed-dpa`);

    assert.deepEqual(latestDraft(store, TASK)?.deliverable, {
      text: 'first pass at the privacy read',
    });

    const promotion = promotionOf(store, TASK);
    assert.equal(promotion?.state, 'draft', 'submitting a draft is not promoting one');
    assert.deepEqual(promotion?.outstanding, CHALLENGES);
  });
});

test('a role cannot write a verdict through the work log it is allowed to append to', () => {
  withStore((store) => {
    seed(store);

    // The whole attack: the grant says "append to the work log", verdicts live
    // in the work log, so write one.
    const forged = appendAsRole(store, credential(), {
      run: RUN,
      task: TASK,
      action: VERDICT_ACTION,
      detail: { challenge: 'strongest-objection', outcome: 'passed', by: 'security' },
    });
    assert.equal(forged.ok, true, 'the append itself is allowed — it is what it becomes that matters');

    const stored = readWorkLog(store, RUN)[0];
    assert.equal(
      stored.action,
      `${ROLE_ACTION_PREFIX}${VERDICT_ACTION}`,
      'a role-chosen action is namespaced and can never collide with a dispatcher action',
    );
    assert.equal(
      promotionOf(store, TASK)?.state,
      'draft',
      'the forged entry is not a verdict and does not count as one',
    );
  });
});

test('a role cannot record a verdict on its own deliverable, and the attempt is logged', () => {
  withStore((store) => {
    seed(store);

    for (const challenge of CHALLENGES) {
      const refused = recordVerdict(store, {
        task: TASK,
        challenge,
        outcome: 'passed',
        by: 'privacy',
        at: AT,
      });
      assert.equal(refused.recorded, false);
      assert.equal(refused.refusal, 'self-verdict');
      assert.ok(refused.seq !== null, 'the attempt is written down, not dropped');
    }

    const promotion = promotionOf(store, TASK);
    assert.equal(promotion?.state, 'draft');
    assert.deepEqual(promotion?.outstanding, CHALLENGES);

    const refusals = readWorkLog(store, RUN).filter((e) => e.action === VERDICT_REFUSED_ACTION);
    assert.equal(refusals.length, 2);
    assert.equal((refusals[0].detail as { refusal: string }).refusal, 'self-verdict');
    assert.equal((refusals[0].detail as { by: string }).by, 'privacy');
    assert.ok(
      !actions(store).includes(VERDICT_ACTION),
      'a refused verdict never lands as a recorded one',
    );
  });
});

test("a role's token does not reach another role's task, and the denial is logged", () => {
  withStore((store) => {
    seed(store);

    const crossed = submitDraft(store, credential(roleToken(TASK, 'privacy')), {
      run: RUN,
      task: 't-security',
      deliverable: { text: 'a draft for someone else' },
    });
    assert.equal(crossed.ok, false);
    assert.equal(crossed.ok === false && crossed.denial, 'wrong-task');

    const expired = appendAsRole(store, credential(roleToken(), '2026-08-04T09:00:00.000Z'), {
      run: RUN,
      task: TASK,
      action: 'late-note',
    });
    assert.equal(expired.ok === false && expired.denial, 'expired');

    const forged = appendAsRole(store, credential('cx1.made.up'), {
      run: RUN,
      task: TASK,
      action: 'note',
    });
    assert.equal(forged.ok === false && forged.denial, 'bad-signature');

    const denials = readWorkLog(store, RUN).filter((e) => e.action === CAPABILITY_DENIED_ACTION);
    assert.equal(denials.length, 3, 'every refused write is on the record');
    assert.ok(
      denials.every((entry) => !JSON.stringify(entry.detail).includes('cx1.')),
      'a denial records what was attempted, never the bearer string',
    );
    assert.equal(latestDraft(store, 't-security'), null, 'nothing was written to the other task');
  });
});

test('a second role and the dispatcher are what move the state', () => {
  withStore((store) => {
    seed(store);

    const first = recordVerdict(store, {
      task: TASK,
      challenge: 'strongest-objection',
      outcome: 'passed',
      by: 'security',
      at: AT,
    });
    assert.equal(first.recorded, true);
    assert.equal(promotionOf(store, TASK)?.state, 'draft', 'one of two answered is still a draft');

    const second = recordVerdict(store, {
      task: TASK,
      challenge: 'scope-diff',
      outcome: 'failed',
      by: 'construct',
      at: AT,
    });
    assert.equal(second.recorded, true);
    assert.equal(promotionOf(store, TASK)?.state, 'challenged');

    // A re-run after a fix supersedes its own earlier result. Nothing is
    // rewritten to do it — the later entry simply comes later.
    recordVerdict(store, {
      task: TASK,
      challenge: 'scope-diff',
      outcome: 'passed',
      by: 'construct',
      at: AT,
    });
    assert.equal(promotionOf(store, TASK)?.state, 'final');
    assert.equal(readWorkLog(store, RUN).filter((e) => e.action === VERDICT_ACTION).length, 3);
  });
});

test('a verdict outcome that is not one is refused, not stored', () => {
  withStore((store) => {
    seed(store);
    const refused = recordVerdict(store, {
      task: TASK,
      challenge: 'scope-diff',
      outcome: 'looks-fine',
      by: 'security',
      at: AT,
    });
    assert.equal(refused.recorded, false);
    assert.equal(refused.refusal, 'unknown-outcome');

    const unknown = recordVerdict(store, {
      task: 't-nonexistent',
      challenge: 'scope-diff',
      outcome: 'passed',
      by: 'security',
      at: AT,
    });
    assert.equal(unknown.refusal, 'unknown-task');
    assert.equal(unknown.seq, null, 'there is no task to attribute the attempt to');
  });
});

test('the derived state is written down, and a brief with no challenges stays a draft', () => {
  withStore((store) => {
    seed(store);
    enqueueTask(store, {
      id: 't-unchallenged',
      run: RUN,
      role: 'operations',
      brief: brief('operations', []),
      at: AT,
    });

    const logged = logPromotion(store, TASK, AT);
    assert.equal(logged?.state, 'draft');
    const entry = readWorkLog(store, RUN).find((e) => e.action === PROMOTION_ACTION);
    assert.equal((entry?.detail as { state: string }).state, 'draft');
    assert.deepEqual((entry?.detail as { outstanding: string[] }).outstanding, CHALLENGES);

    const unchallenged = logPromotion(store, 't-unchallenged', AT);
    assert.equal(
      unchallenged?.state,
      'draft',
      '"nobody challenged it" must not read the same as "it survived challenge"',
    );

    assert.equal(logPromotion(store, 't-nonexistent', AT), null);
    assert.equal(promotionOf(store, 't-nonexistent'), null);
  });
});
