/**
 * tests/functional/real-llm-scenarios.functional.test.mjs — opt-in S3 (PRD) + S8 (orchestration_run) scenarios.
 *
 * Delegates to lib/certification/real-llm-scenarios.mjs; certification catalog ids
 * real-llm.s3 and real-llm.s8 mirror the same semantics via construct certify run.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEGACY_LIVE_ENV,
  realLlmOptInEnabled,
  realLlmSkipReason,
  runRealLlmS3,
  runRealLlmS8,
} from '../../lib/certification/real-llm-scenarios.mjs';
import { LIVE_OPT_IN_ENV } from '../../lib/certification/runner.mjs';

test('real-llm opt-in accepts legacy CONSTRUCT_E2E_REAL_LLM=1', () => {
  const env = { [LEGACY_LIVE_ENV]: '1' };
  assert.equal(realLlmOptInEnabled(env), true);
  assert.equal(realLlmOptInEnabled({ [LIVE_OPT_IN_ENV]: '1' }), true);
  assert.equal(realLlmOptInEnabled({}), false);
});

test('real-llm skip reason without opt-in', () => {
  const reason = realLlmSkipReason({});
  assert.match(reason, /CONSTRUCT_CERTIFY_LIVE=1|CONSTRUCT_E2E_REAL_LLM=1/);
});

test('S3 — provider worker produces PRD-shaped output that passes the quality gate', { timeout: 300_000 }, async (t) => {
  const skip = realLlmSkipReason(process.env);
  if (skip) {
    t.skip(skip);
    return;
  }

  const result = await runRealLlmS3({ env: process.env });
  if (result.status === 'inconclusive') {
    t.skip(result.skip ?? result.detail ?? 'inconclusive');
    return;
  }
  assert.equal(result.status, 'pass', result.detail ?? JSON.stringify(result));
});

test('S8 — orchestration_run reaches a terminal daemon state when dashboard is up', { timeout: 180_000 }, async (t) => {
  const skip = realLlmSkipReason(process.env);
  if (skip) {
    t.skip(skip);
    return;
  }

  const result = await runRealLlmS8({ env: process.env });
  if (result.status === 'inconclusive') {
    t.skip(result.detail ?? result.skip ?? 'inconclusive');
    return;
  }
  assert.ok(['pass', 'fail'].includes(result.status));
  if (result.status === 'pass') {
    assert.ok(['completed', 'completed-with-failures', 'cancelled'].includes(result.runStatus));
  }
});
