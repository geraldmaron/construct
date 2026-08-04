/**
 * tests/kernel/completion/promotion.test.ts — the reliance axis.
 *
 * The two properties worth pinning are the ones that a future refactor would
 * otherwise "simplify" away: a deliverable nobody challenged is not final, and
 * a role cannot promote itself by recording its own verdict.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROMOTION_STATES,
  isPromotionState,
  promotionState,
} from '../../../src/kernel/completion/promotion.ts';
import { COMPLETION_STATES } from '../../../src/kernel/completion/states.ts';
import type { Verdict } from '../../../src/kernel/completion/promotion.ts';

const REQUIRED = ['strongest-objection', 'scope-diff'];

function verdict(challenge: string, outcome: Verdict['outcome'], by: string): Verdict {
  return { challenge, outcome, by };
}

test('the two ladders share no vocabulary — they are different axes', () => {
  for (const state of PROMOTION_STATES) {
    assert.ok(
      !(COMPLETION_STATES as readonly string[]).includes(state),
      `${state} must not also be a production rung — see the decision in promotion.ts`,
    );
  }
  assert.ok(isPromotionState('draft'));
  assert.ok(!isPromotionState('approved'), 'a production rung is not a promotion state');
});

test('an unanswered challenge holds the deliverable at draft', () => {
  const partial = promotionState({
    role: 'privacy',
    required: REQUIRED,
    verdicts: [verdict('strongest-objection', 'passed', 'security')],
  });
  assert.equal(partial.state, 'draft');
  assert.deepEqual(partial.outstanding, ['scope-diff']);
});

test('a deliverable nobody challenged is a draft, not a final', () => {
  const unchallenged = promotionState({ role: 'privacy', required: [], verdicts: [] });
  assert.equal(
    unchallenged.state,
    'draft',
    '"nobody challenged it" and "it survived challenge" must not give the same answer',
  );
});

test('all answered and passing is final; a failure holds at challenged', () => {
  const passed = promotionState({
    role: 'privacy',
    required: REQUIRED,
    verdicts: [
      verdict('strongest-objection', 'passed', 'security'),
      verdict('scope-diff', 'passed', 'dispatcher'),
    ],
  });
  assert.equal(passed.state, 'final');
  assert.deepEqual(passed.failing, []);

  const failed = promotionState({
    role: 'privacy',
    required: REQUIRED,
    verdicts: [
      verdict('strongest-objection', 'failed', 'security'),
      verdict('scope-diff', 'passed', 'dispatcher'),
    ],
  });
  assert.equal(failed.state, 'challenged', 'a failure must not erase back to draft');
  assert.deepEqual(failed.failing, ['strongest-objection']);
});

test('a waiver is a real answer, and it comes from the user', () => {
  const waived = promotionState({
    role: 'privacy',
    required: REQUIRED,
    verdicts: [
      verdict('strongest-objection', 'waived', 'user'),
      verdict('scope-diff', 'passed', 'dispatcher'),
    ],
  });
  assert.equal(waived.state, 'final');

  // A role waiving its own challenge is the predecessor's live failure mode.
  const selfWaived = promotionState({
    role: 'privacy',
    required: REQUIRED,
    verdicts: [
      verdict('strongest-objection', 'waived', 'privacy'),
      verdict('scope-diff', 'passed', 'dispatcher'),
    ],
  });
  assert.equal(selfWaived.state, 'draft', 'a role cannot waive its own challenge');
  assert.deepEqual(selfWaived.outstanding, ['strongest-objection']);
  assert.equal(selfWaived.rejected.length, 1, 'the attempt is kept so a caller can log it');
  assert.equal(selfWaived.rejected[0].by, 'privacy');
});

test('a role cannot promote itself by passing its own challenges', () => {
  const selfPassed = promotionState({
    role: 'privacy',
    required: REQUIRED,
    verdicts: REQUIRED.map((challenge) => verdict(challenge, 'passed', 'privacy')),
  });
  assert.equal(selfPassed.state, 'draft');
  assert.equal(selfPassed.rejected.length, 2);
  assert.deepEqual(selfPassed.outstanding, REQUIRED);
});

test('a re-run supersedes its own earlier verdict', () => {
  const fixed = promotionState({
    role: 'privacy',
    required: ['scope-diff'],
    verdicts: [
      verdict('scope-diff', 'failed', 'dispatcher'),
      verdict('scope-diff', 'passed', 'dispatcher'),
    ],
  });
  assert.equal(fixed.state, 'final');

  const regressed = promotionState({
    role: 'privacy',
    required: ['scope-diff'],
    verdicts: [
      verdict('scope-diff', 'passed', 'dispatcher'),
      verdict('scope-diff', 'failed', 'dispatcher'),
    ],
  });
  assert.equal(regressed.state, 'challenged', 'a later failure supersedes an earlier pass');
});
