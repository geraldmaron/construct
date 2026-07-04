/**
 * tests/functional/model-resolver-credential-fallback.functional.test.mjs
 *
 * Locks in construct-uccl.2: with no model tier pinned, resolveEmbeddedModel
 * consults configured provider credentials via listModelFamilies and falls
 * back to that family's tier default rather than degrading straight to a
 * config-error whose remediation ("configure a provider credential") no
 * unpinned env could ever satisfy. An explicit pin always wins over the
 * fallback, and with neither a pin nor a credential the remediation names
 * the exact next step.
 *
 * Every provider env var is scrubbed to a known-empty baseline before each
 * case is built, so an ambient credential on the machine running this suite
 * cannot leak into a case that expects config-error.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveEmbeddedModel } from '../../lib/embedded-contract/model-resolve.mjs';

const PROVIDER_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'OPEN_ROUTER_API_KEY',
  'OPENAI_API_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'OLLAMA_BASE_URL',
  'OLLAMA_HOST',
  'LOCAL_LLM_BASE_URL',
  'CX_MODEL_STANDARD',
  'CX_MODEL_REASONING',
  'CX_MODEL_FAST',
  'CONSTRUCT_MODEL_STANDARD',
  'CONSTRUCT_MODEL_REASONING',
  'CONSTRUCT_MODEL_FAST',
];

function scrubbedEnv(overrides = {}) {
  const env = {};
  for (const key of PROVIDER_KEYS) env[key] = undefined;
  return { ...env, ...overrides };
}

test('[uccl.2] credential-only resolves to the family default, warned, with a distinct source', () => {
  const env = scrubbedEnv({ ANTHROPIC_API_KEY: 'sk-test-canary' });
  const r = resolveEmbeddedModel({ requestedTier: 'standard' }, { env });
  assert.equal(r.resolutionSource, 'credential-family-fallback');
  assert.equal(r.selectedProvider, 'anthropic');
  assert.ok(r.selectedModel, 'a family default model must resolve');
  assert.match(r.warnings.join('\n'), /anthropic/);
  assert.equal(JSON.stringify(r).includes('sk-test-canary'), false, 'secret must never leak into the result');
});

test('[uccl.2] an explicit pin suppresses the credential fallback entirely', () => {
  const env = scrubbedEnv({ ANTHROPIC_API_KEY: 'sk-test-canary', CX_MODEL_STANDARD: 'anthropic/claude-sonnet-4-6' });
  const r = resolveEmbeddedModel({ requestedTier: 'standard' }, { env });
  assert.equal(r.selectedModel, 'anthropic/claude-sonnet-4-6');
  assert.equal(r.resolutionSource, 'tier-default');
  assert.deepEqual(r.warnings, [], 'no fallback warning when explicitly pinned');
});

test('[uccl.2] neither pin nor credential leaves a followable remediation with no ".."', () => {
  const env = scrubbedEnv();
  const r = resolveEmbeddedModel({ requestedTier: 'standard' }, { env });
  assert.equal(r.selectedModel, null);
  assert.equal(r.resolutionSource, 'config-error');
  assert.match(r.error.remediation, /CX_MODEL_STANDARD|ANTHROPIC_API_KEY/);
  assert.ok(!r.error.remediation.includes('..'), 'remediation must not contain a double period');
});

test('[uccl.2] execution.mjs degradationReason never contains a double period', async () => {
  const { resolveExecution } = await import('../../lib/embedded-contract/execution.mjs');
  const env = scrubbedEnv();
  const r = resolveExecution({ requestedStrategy: 'orchestrated' }, { env });
  assert.equal(r.resolutionSource, 'config-error');
  assert.ok(r.degradationReason);
  assert.ok(!r.degradationReason.includes('..'), 'degradationReason must not contain a double period');
});
