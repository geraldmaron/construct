/**
 * tests/hosts/tiers.test.ts — each host's declaration of which of its models sit
 * at which capability tier (construct-ap0).
 *
 * This is the half of the feature the kernel is forbidden to know. The kernel
 * compares ordinals; the vendor model names live beside each adapter's pin, and
 * these tests are about the mapping's SHAPE rather than any particular name:
 * recognised models get a tier, and everything else gets null.
 *
 * Null is the case worth guarding. It degrades a declared floor instead of
 * satisfying it, so a tier table that guessed upward on an unfamiliar name would
 * let a run claim it met a floor nobody checked — which is the failure the whole
 * ordinal exists to make impossible.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tierOfModel as opencodeTier } from '../../src/hosts/opencode/pin.ts';
import { tierOfModel as claudeTier } from '../../src/hosts/claude/pin.ts';

test('a small local model is the floor of the scale, not an unknown', () => {
  // The pairing behind construct-185's undecidable silence.
  assert.equal(opencodeTier('ollama/qwen3.5:4b'), 'any');
  assert.equal(opencodeTier('ollama/qwen3.6:35b'), 'any', 'a local model is still local');
});

test('a frontier model is distinguishable from a merely capable one', () => {
  assert.equal(opencodeTier('anthropic/claude-opus-5'), 'frontier');
  assert.equal(opencodeTier('anthropic/claude-sonnet-5'), 'capable');
  assert.equal(claudeTier('opus'), 'frontier');
  assert.equal(claudeTier('sonnet'), 'capable');
  assert.equal(claudeTier('claude-haiku-4-5-20251001'), 'capable');
});

test('an unrecognised model is null, never a guess', () => {
  for (const unknown of ['some-vendor/some-model', 'gpt-5', 'llama-9', '']) {
    assert.equal(opencodeTier(unknown), null, `${unknown} must not be guessed`);
    assert.equal(claudeTier(unknown), null, `${unknown} must not be guessed`);
  }
  assert.equal(opencodeTier(null), null);
  assert.equal(opencodeTier(undefined), null);
});

test('the mapping stays out of the kernel', async () => {
  // The constraint in the bead's own words: the kernel compares ordinals and
  // adapters own tier membership. A vendor name reaching kernel/ is the drift
  // this asserts against, and it is cheaper to catch here than in review.
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const tiers = readFileSync(
    fileURLToPath(new URL('../../src/kernel/brief/tiers.ts', import.meta.url)),
    'utf8',
  );
  // Prose in the module note legitimately explains WHY, so only the executable
  // half is checked: no vendor string may appear in a literal.
  const code = tiers.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const vendor of ['ollama', 'anthropic', 'claude', 'opus', 'sonnet', 'gpt', 'llama']) {
    assert.doesNotMatch(
      code,
      new RegExp(vendor, 'i'),
      `kernel/brief/tiers.ts must not name "${vendor}" — tier membership is the adapter's`,
    );
  }
});
