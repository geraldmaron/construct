/**
 * tests/model-free-selector.test.mjs — selector logic for the free-model
 * auto-applier. No network: drives the functions with synthetic catalog
 * shapes to lock in tier thresholds, scoring, and fallback behaviour.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  selectForTier,
  topForTier,
  isFreeModel,
  preferFreeValue,
  score,
} from '../lib/model-free-selector.mjs';

function model(id, contextLength) {
  return { id, name: id, contextLength, isFree: true };
}

const CATALOG = [
  model('openrouter/deepseek/deepseek-r1', 64_000),
  model('openrouter/qwen/qwen3-coder:free', 32_000),
  model('openrouter/meta-llama/llama-3.3-70b-instruct:free', 16_000),
  model('openrouter/google/gemma-3-27b-it:free', 8_192),
  model('openrouter/tiny/model:free', 4_096),
];

test('selectForTier picks reasoning-capable models with >=32k context', () => {
  const id = selectForTier(CATALOG, 'reasoning', []);
  assert.equal(id, 'openrouter/deepseek/deepseek-r1');
});

test('selectForTier respects the 16k standard threshold', () => {
  const subset = CATALOG.filter((m) => !m.id.includes('deepseek') && !m.id.includes('qwen3-coder'));
  const id = selectForTier(subset, 'standard', []);
  assert.equal(id, 'openrouter/meta-llama/llama-3.3-70b-instruct:free');
});

test('selectForTier falls back to the registry fallback chain when no free model qualifies', () => {
  const id = selectForTier([model('tiny:free', 1024)], 'reasoning', ['anthropic/claude-opus-4-6']);
  assert.equal(id, 'anthropic/claude-opus-4-6');
});

test('selectForTier returns null when the catalog is empty and no fallback is given', () => {
  const id = selectForTier([], 'standard', []);
  assert.equal(id, null);
});

test('topForTier returns descending scores capped at N', () => {
  const top = topForTier(CATALOG, 'reasoning', 2);
  assert.equal(top.length, 2);
  assert.ok(top[0].tierScore >= top[1].tierScore);
  assert.equal(top[0].id, 'openrouter/deepseek/deepseek-r1');
});

test('isFreeModel detects the :free suffix', () => {
  assert.equal(isFreeModel('openrouter/qwen/qwen3-coder:free'), true);
  assert.equal(isFreeModel('openrouter/qwen/qwen3-coder'), false);
});

test('preferFreeValue picks the first free candidate in precedence order', () => {
  assert.equal(preferFreeValue('a:free', 'b', null, null), 'a:free');
  assert.equal(preferFreeValue('a', 'b:free', null, null), 'b:free');
  assert.equal(preferFreeValue('a', 'b', 'c:free', null), 'c:free');
  assert.equal(preferFreeValue('a', 'b', null, null), 'a');
  assert.equal(preferFreeValue(null, null, null, null), null);
});

test('score rewards reasoning-capable + long-context models when tier is reasoning', () => {
  const a = score(model('openrouter/deepseek/deepseek-r1', 64_000), 'reasoning');
  const b = score(model('openrouter/tiny/foo', 8_192), 'reasoning');
  assert.ok(a > b);
});
