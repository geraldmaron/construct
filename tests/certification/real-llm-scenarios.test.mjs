/**
 * tests/certification/real-llm-scenarios.test.mjs — S3/S8 certification harness exports.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  realLlmOptInEnabled,
  realLlmSkipReason,
  LEGACY_LIVE_ENV,
} from '../../lib/certification/real-llm-scenarios.mjs';
import { LIVE_OPT_IN_ENV } from '../../lib/certification/runner.mjs';

test('real LLM harness stays hermetic without opt-in env', () => {
  assert.equal(realLlmOptInEnabled({}), false);
  assert.match(realLlmSkipReason({}), new RegExp(LIVE_OPT_IN_ENV));
});

test('legacy CONSTRUCT_E2E_REAL_LLM alias enables opt-in', () => {
  assert.equal(realLlmOptInEnabled({ [LEGACY_LIVE_ENV]: '1' }), true);
});
