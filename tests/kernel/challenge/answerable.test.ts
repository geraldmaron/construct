/**
 * The question-shaped half of ground exhaustion.
 *
 * The cases below are drawn from a recorded run against a real repository,
 * because a check built only against invented fixtures is how the last two
 * false passes happened: it agrees with its author about what the failure looks
 * like and never meets the one that shipped.
 *
 * Most of these tests are about what the check refuses to flag. That is the
 * proportion the check itself has to hold: an open question is usually honest,
 * and a gate that dragged honest ones back would teach roles to stop asking,
 * which costs more than this catches.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handbacksEarned, unearnedHandbacks } from '../../../src/kernel/challenge/answerable.ts';

const ROOTS = ['/repo'];

test('a question naming a code symbol is work, not a question', () => {
  const draft =
    "Step: confirm whether `commitCanonicalWrite`'s merge branch calls " +
    '`assertNoCrossSourceProfileAggregation` before this lane is expanded.';

  const found = unearnedHandbacks(draft);

  assert.equal(found.length, 1);
  assert.equal(found[0].referent, 'commitCanonicalWrite');
  assert.equal(handbacksEarned(draft, ROOTS).passed, false);
});

test('a question naming a qualified table is work, not a question', () => {
  const draft =
    'Determine whether bb_canonical.claims being empty is a scheduled migration gap ' +
    'or a permanent bypass of the provenance invariant.';

  assert.equal(unearnedHandbacks(draft)[0].referent, 'bb_canonical.claims');
});

test('a question naming the code as where the answer lives is work, not a question', () => {
  const draft =
    'Confirm, against the actual kill-switch code, which store each containment-order ' +
    'switch reads from today.';

  const found = unearnedHandbacks(draft);

  assert.equal(found.length, 1);
  assert.match(found[0].referent, /kill-switch code/);
});

test('a question about intent names nothing searchable and is left alone', () => {
  const draft =
    'Whether activating a UGC discovery adapter is actually a candidate for the next block ' +
    'of engineering work, or whether the compliance layer was built with no near-term ' +
    'activation intent, is unclear from the material.';

  assert.deepEqual(unearnedHandbacks(draft), []);
});

test('a question about a person or an external event is left alone', () => {
  const draft =
    'Whether licensed counsel has reviewed the living-person legal posture is unconfirmed, ' +
    'and no document states a funding allocation or headcount.';

  assert.deepEqual(unearnedHandbacks(draft), []);
});

/**
 * Every honest ending passes, including the one where the search came back
 * empty. "I looked and there is nothing there" is an answer; the check exists
 * to catch naming the place and stopping, not to demand a particular result.
 */
test('a search that was run and reported nothing is an answer', () => {
  const draft =
    'I grepped for `assertNoCrossSourceProfileAggregation` in the merge branch and there is ' +
    'no such call, so the guard does not run on the admin lane.';

  assert.deepEqual(unearnedHandbacks(draft), []);
});

test('a stated access failure is a fact about access, and passes', () => {
  const draft =
    'Confirm whether `commitCanonicalWrite` calls the guard — I could not read ' +
    'packages/domain/src/canonical.ts, permission denied.';

  assert.deepEqual(unearnedHandbacks(draft), []);
});

/**
 * Self-limiting the same way ground exhaustion is. A dispatch with no roots
 * gave the role its listed documents and nothing else, so a question it could
 * not have searched is not one it should have answered.
 */
test('with no declared roots there was no ground to search, and the check says so', () => {
  const draft = 'Confirm whether `commitCanonicalWrite` calls the aggregation guard.';

  const check = handbacksEarned(draft, []);

  assert.equal(check.passed, true);
  assert.match(check.detail, /no declared roots/);
});

test('a finding that merely mentions a symbol is not a handback', () => {
  const draft =
    'The `commitCanonicalWrite` path enforces provenance through a foreign key, which is why ' +
    'the empty claims table matters.';

  assert.deepEqual(unearnedHandbacks(draft), []);
});

test('the failing detail tells the role which sentence and what it named', () => {
  const check = handbacksEarned(
    'Confirm whether `commitCanonicalWrite` runs the guard.',
    ROOTS,
  );

  assert.equal(check.passed, false);
  assert.match(check.detail, /commitCanonicalWrite/);
  assert.match(check.detail, /same license and less context/);
});
