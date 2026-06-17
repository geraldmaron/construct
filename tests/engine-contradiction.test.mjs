/**
 * tests/engine-contradiction.test.mjs — negation-polarity contradiction detection (construct-wlr7).
 *
 * Pins the offline heuristic: same claim words with opposite assertion polarity
 * contradict; same words with the same polarity (a restatement) do not; two
 * different subjects do not; a value swap with no negation cue is explicitly
 * NOT caught here (it needs the optional judge plugin).
 */
import test from 'node:test';
import assert from 'node:assert';
import { detectContradiction } from '../lib/engine/contradiction.mjs';

test('opposite polarity on the same claim contradicts', () => {
  const r = detectContradiction('auth is supported on the gateway', 'auth is not supported on the gateway');
  assert.equal(r.contradicts, true);
  assert.equal(r.reason, 'negation-polarity');
  assert.notEqual(r.negDelta, 0);
});

test('a contracted negation is recognized', () => {
  assert.equal(detectContradiction('the cache invalidates on write', "the cache doesn't invalidate on write").contradicts, true);
});

test('a restatement (same polarity) does not contradict', () => {
  assert.equal(detectContradiction('auth uses RS256 tokens', 'auth uses RS256 tokens (confirmed)').contradicts, false);
});

test('different subjects do not contradict even with a negation', () => {
  assert.equal(detectContradiction('rate limiting is missing', 'the dashboard renders charts').contradicts, false);
});

test('a value swap with no negation cue is not caught by the heuristic', () => {
  // "RS256" vs "HS256" is a real contradiction carrying no negation cue —
  // resolving that case needs the optional judge plugin, so the heuristic abstains.
  assert.equal(detectContradiction('auth uses RS256', 'auth uses HS256').contradicts, false);
});

test('empty or cue-only text does not contradict', () => {
  assert.equal(detectContradiction('', 'not').contradicts, false);
  assert.equal(detectContradiction('not', 'never').contradicts, false);
});
