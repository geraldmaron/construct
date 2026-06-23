/**
 * tests/certification/prompt-budget.test.mjs — composed prompt budget evidence.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { measurePromptBudgetChains, listOperatingProfileThresholds } from '../../lib/certification/prompt-budget.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('representative workflow chains stay within operating profile budget', () => {
  const result = measurePromptBudgetChains({ rootDir: REPO });
  assert.equal(result.pass, true, result.errors.join('\n'));
  assert.ok(result.chains.length >= 3);
  assert.ok(result.profile.maxPromptTokens >= 1800);
});

test('profile thresholds cite model-router operating profiles', () => {
  const thresholds = listOperatingProfileThresholds();
  assert.ok(thresholds.some((t) => t.id === 'balanced'));
  assert.ok(thresholds.some((t) => t.id === 'small'));
});
