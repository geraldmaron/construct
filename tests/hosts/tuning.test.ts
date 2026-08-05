/**
 * tests/hosts/tuning.test.ts — the model matrix's tuning record: family
 * membership is conservative, the best-effort default covers silence, and the
 * stamp carries its own dates so staleness is visible in the output.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TUNED_FAMILIES, tuningOf, tuningStamp } from '../../src/hosts/tuning.ts';

test('claude-family model strings are tuned, with and without a provider prefix', () => {
  assert.deepEqual(tuningOf('claude-sonnet-5'), { family: 'claude', tuned: true });
  assert.deepEqual(tuningOf('anthropic/claude-fable-5'), { family: 'claude', tuned: true });
});

test('an unrecognised or absent model is untuned, never unknown', () => {
  assert.deepEqual(tuningOf('ollama/qwen3.5:4b'), { family: null, tuned: false });
  assert.deepEqual(tuningOf(undefined), { family: null, tuned: false });
  assert.deepEqual(tuningOf(null), { family: null, tuned: false });
});

test('a model merely containing "claude" in a path segment does not match the family', () => {
  assert.equal(tuningOf('ollama/notclaude-7b').tuned, false);
});

test('every tuned family names its evidence and the date it was recorded', () => {
  for (const family of TUNED_FAMILIES) {
    assert.match(family.tunedOn, /^\d{4}-\d{2}-\d{2}$/, `${family.family} has no dated evidence`);
    assert.ok(family.evidence.length > 0, `${family.family} names no evidence`);
  }
});

test('the stamp is stale-loudly: it carries every tuned-on date', () => {
  const stamp = tuningStamp();
  for (const family of TUNED_FAMILIES) {
    assert.ok(stamp.includes(family.tunedOn), `stamp omits ${family.family}'s date`);
  }
  assert.match(stamp, /best-effort/);
});
