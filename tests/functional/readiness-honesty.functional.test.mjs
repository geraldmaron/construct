/**
 * tests/functional/readiness-honesty.functional.test.mjs
 *
 * Locks in three readiness-gate honesty fixes (construct-1yhp.3):
 *   1. orchestration_readiness over MCP only claims observationScope
 *      'host-session' when the caller actually reported what it observed;
 *      a server-self-report catalog gets its own label and a disclosed
 *      caveat, never the serve-ability label it did not earn.
 *   2. A configured CONSTRUCT_ORCHESTRATION_URL makes remote auth required
 *      on its own — no --auth-required opt-in needed to catch a missing
 *      token.
 *   3. Every collected env fact in the diagnostic bundle is read by the
 *      verdict chain (not collected-and-discarded), and an unresolved
 *      op://vault/item/field literal is not counted as a materialized key.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildOrchestrationReadiness } from '../../lib/orchestration/readiness.mjs';
import { dispatchToolByName } from '../../lib/mcp/server.mjs';

test('MCP orchestration_readiness with no caller-observed tools reports server-self-report, not host-session', async () => {
  const result = await dispatchToolByName('orchestration_readiness', {});
  assert.equal(result.observationScope, 'server-self-report');
  assert.notEqual(result.observationScope, 'host-session');
  assert.match(result.diagnosticBundle.detail, /self-report/i);
});

test('MCP orchestration_readiness with caller-supplied observed_tools still reports host-session', async () => {
  const result = await dispatchToolByName('orchestration_readiness', {
    observed_tools: ['orchestration_policy', 'orchestration_run', 'orchestration_readiness'],
  });
  assert.equal(result.observationScope, 'host-session');
  assert.doesNotMatch(result.diagnosticBundle.detail, /self-report/i);
});

test('CONSTRUCT_ORCHESTRATION_URL set with no token yields auth_unavailable without --auth-required', () => {
  const readiness = buildOrchestrationReadiness(
    { observedTools: ['orchestration_policy', 'orchestration_run'] },
    { env: { CONSTRUCT_ORCHESTRATION_URL: 'https://orch.example' }, cwd: '/tmp/project' },
  );
  assert.equal(readiness.reasonCode, 'auth_unavailable');
  assert.equal(readiness.verdict, 'fail');
  assert.match(readiness.diagnosticBundle.detail, /CONSTRUCT_ORCHESTRATION_URL/);
});

test('CONSTRUCT_ORCHESTRATION_URL with a token configured does not require --auth-required either', () => {
  const readiness = buildOrchestrationReadiness(
    {
      observedTools: ['orchestration_policy', 'orchestration_run'],
    },
    {
      env: {
        CONSTRUCT_ORCHESTRATION_URL: 'https://orch.example',
        CONSTRUCT_ORCHESTRATION_TOKEN: 'token-secret-value',
        CONSTRUCT_MODEL_REASONING: 'anthropic/claude-sonnet-4-6',
        CONSTRUCT_MODEL_STANDARD: 'anthropic/claude-sonnet-4-6',
        CONSTRUCT_MODEL_FAST: 'anthropic/claude-sonnet-4-6',
        ANTHROPIC_API_KEY: 'sk-test-canary',
      },
      cwd: '/tmp/project',
    },
  );
  assert.notEqual(readiness.reasonCode, 'auth_unavailable');
});

test('an unresolved op:// literal is not counted as a materialized provider key', () => {
  const readiness = buildOrchestrationReadiness(
    { observedTools: ['orchestration_policy', 'orchestration_run'] },
    { env: { ANTHROPIC_API_KEY: 'op://vault/anthropic/credential' }, cwd: '/tmp/project' },
  );
  assert.equal(readiness.diagnosticBundle.env.hasAnthropicKey, false);
});

test('a materialized (non-op://) key is still counted', () => {
  const readiness = buildOrchestrationReadiness(
    { observedTools: ['orchestration_policy', 'orchestration_run'] },
    { env: { ANTHROPIC_API_KEY: 'sk-ant-real-value' }, cwd: '/tmp/project' },
  );
  assert.equal(readiness.diagnosticBundle.env.hasAnthropicKey, true);
});

test('model_unresolved detail reads the collected provider-key env facts instead of discarding them', () => {
  const readiness = buildOrchestrationReadiness(
    { observedTools: ['orchestration_policy', 'orchestration_run'] },
    { env: {}, cwd: '/tmp/project' },
  );
  assert.equal(readiness.reasonCode, 'model_unresolved');
  assert.equal(readiness.diagnosticBundle.env.hasAnthropicKey, false);
  assert.match(readiness.diagnosticBundle.detail, /no provider key detected/i);
});

test('the dead version_mismatch gate is now trippable: an old caller-reported client_contract_version fails it', () => {
  const readiness = buildOrchestrationReadiness(
    { observedTools: ['orchestration_policy', 'orchestration_run'], clientContractVersion: '0.0.1' },
    { env: {}, cwd: '/tmp/project' },
  );
  assert.equal(readiness.reasonCode, 'version_mismatch');
});

test('an unreported client_contract_version no longer self-defaults to a value that always passes', () => {
  const readiness = buildOrchestrationReadiness(
    { observedTools: ['orchestration_policy', 'orchestration_run'] },
    { env: {}, cwd: '/tmp/project' },
  );
  assert.notEqual(readiness.reasonCode, 'version_mismatch');
  assert.equal(readiness.diagnosticBundle.clientContractVersion, null);
});
