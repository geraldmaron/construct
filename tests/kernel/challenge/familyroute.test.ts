/**
 * tests/kernel/challenge/familyroute.test.ts — the pure decision behind
 * which family answers a challenge or judge pass.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseChallengeFamily, CORRELATED_ERROR_CAVEAT } from '../../../src/kernel/challenge/familyroute.ts';

test('a genuinely different available family is chosen, with no caveat', () => {
  const choice = chooseChallengeFamily({ producerFamily: 'claude', availableFamilies: ['gpt', 'claude'] });
  assert.equal(choice.family, 'gpt');
  assert.equal(choice.sameFamily, false);
  assert.equal(choice.caveat, null);
});

test('with no other family available, the fallback is same-family with the caveat', () => {
  const choice = chooseChallengeFamily({ producerFamily: 'claude', availableFamilies: [] });
  assert.equal(choice.family, 'claude');
  assert.equal(choice.sameFamily, true);
  assert.equal(choice.caveat, CORRELATED_ERROR_CAVEAT);
});

test('with only the same family available, the fallback is same-family with the caveat', () => {
  const choice = chooseChallengeFamily({ producerFamily: 'claude', availableFamilies: ['claude'] });
  assert.equal(choice.sameFamily, true);
  assert.equal(choice.caveat, CORRELATED_ERROR_CAVEAT);
});

test('an unknown producer family never licenses a claim of independence', () => {
  // Not knowing the producer's family is not evidence that some other family
  // differs from it — treated as conservatively as a proven same-family match.
  const choice = chooseChallengeFamily({ producerFamily: null, availableFamilies: ['gpt', 'claude'] });
  assert.equal(choice.sameFamily, true);
  assert.equal(choice.caveat, CORRELATED_ERROR_CAVEAT);
  assert.equal(choice.family, null);
});

test('the caveat text is the house phrase, verbatim', () => {
  assert.match(CORRELATED_ERROR_CAVEAT, /upper bound on independent agreement/);
});
