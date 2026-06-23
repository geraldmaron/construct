/**
 * tests/certification/real-llm-scenarios.test.mjs — S3/S8 certification harness exports.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  realLlmOptInEnabled,
  realLlmSkipReason,
  resolveRealLlmProvider,
  buildPrdPolishMessages,
  LEGACY_LIVE_ENV,
  REAL_LLM_PROVIDER_ENV,
  DEFAULT_REAL_LLM_PROVIDER,
  DEFAULT_REAL_LLM_MODEL,
} from '../../lib/certification/real-llm-scenarios.mjs';
import { LIVE_OPT_IN_ENV } from '../../lib/certification/runner.mjs';

test('real LLM harness stays hermetic without opt-in env', () => {
  assert.equal(realLlmOptInEnabled({}), false);
  assert.match(realLlmSkipReason({}), new RegExp(LIVE_OPT_IN_ENV));
});

test('legacy CONSTRUCT_E2E_REAL_LLM alias enables opt-in', () => {
  assert.equal(realLlmOptInEnabled({ [LEGACY_LIVE_ENV]: '1' }), true);
});

test('resolveRealLlmProvider defaults to OpenRouter when key is present', () => {
  const env = { OPENROUTER_API_KEY: 'sk-or-test' };
  const live = resolveRealLlmProvider(env);
  assert.deepEqual(live, {
    provider: DEFAULT_REAL_LLM_PROVIDER,
    model: DEFAULT_REAL_LLM_MODEL,
  });
});

test('resolveRealLlmProvider skips without OPENROUTER_API_KEY by default', () => {
  const env = { ANTHROPIC_API_KEY: 'sk-ant' };
  const live = resolveRealLlmProvider(env);
  assert.match(live.skip, /OPENROUTER_API_KEY/);
});

test('resolveRealLlmProvider honors explicit provider override', () => {
  const env = {
    [REAL_LLM_PROVIDER_ENV]: 'anthropic',
    ANTHROPIC_API_KEY: 'sk-ant',
  };
  const live = resolveRealLlmProvider(env);
  assert.equal(live.provider, 'anthropic');
  assert.equal(live.model, 'claude-sonnet-4-20250514');
});

test('buildPrdPolishMessages encodes PRD structure and specialist context', () => {
  const { system, user } = buildPrdPolishMessages({
    requestSummary: 'Billing isolation PRD',
    specialistOutputs: ['PM draft paragraph one.', 'Architect risks paragraph.'],
  });
  assert.match(system, /Problem/);
  assert.match(system, /Success metrics/);
  assert.match(system, /mermaid flowchart/);
  assert.match(system, /Metric \| Baseline \| Target/);
  assert.match(user, /Billing isolation PRD/);
  assert.match(user, /Specialist 1/);
  assert.match(user, /Architect risks/);
});

test('resolveRealLlmProvider selects copilot only when explicitly requested', () => {
  const env = {
    [REAL_LLM_PROVIDER_ENV]: 'copilot',
    OPENROUTER_API_KEY: 'sk-or-test',
  };
  const live = resolveRealLlmProvider(env);
  assert.equal(live.provider, 'github-copilot');
  assert.equal(live.requiresAsyncModel, true);
});
