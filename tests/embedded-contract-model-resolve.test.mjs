/**
 * tests/embedded-contract-model-resolve.test.mjs — unit tests for embedded model resolution.
 *
 * Pins the resolution precedence (host-model → same-family → tier-default →
 * config-error), the cross-provider gate, the env-derived requiresCredential
 * boolean, the unverified-health contract, and best-effort capability matching.
 * All cases inject env so they are deterministic and never touch real creds.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveEmbeddedModel } from '../lib/embedded-contract/model-resolve.mjs';

const NO_CREDS = { PATH: '/usr/bin' };

test('host-model: recognized host model is honored and reported verbatim', () => {
  const r = resolveEmbeddedModel({ hostModel: 'anthropic/claude-sonnet-4-6' }, { env: NO_CREDS });
  assert.equal(r.resolutionSource, 'host-model');
  assert.equal(r.selectedModel, 'anthropic/claude-sonnet-4-6');
  assert.equal(r.providerFamily, 'anthropic');
  assert.equal(r.error, null);
});

test('requiresCredential: env-derived boolean, never a value', () => {
  const missing = resolveEmbeddedModel({ hostModel: 'anthropic/claude-sonnet-4-6' }, { env: NO_CREDS });
  assert.equal(missing.requiresCredential, true);
  const present = resolveEmbeddedModel({ hostModel: 'anthropic/claude-sonnet-4-6' }, { env: { ANTHROPIC_API_KEY: 'cred-canary-value' } });
  assert.equal(present.requiresCredential, false);
  const local = resolveEmbeddedModel({ hostModel: 'ollama/llama3.1:8b' }, { env: NO_CREDS });
  assert.equal(local.requiresCredential, false);
});

test('same-family-fallback: provider context resolves the tier model in-family', () => {
  const r = resolveEmbeddedModel({ hostProvider: 'anthropic', requestedTier: 'reasoning' }, { env: NO_CREDS });
  assert.equal(r.resolutionSource, 'same-family-fallback');
  assert.equal(r.providerFamily, 'anthropic');
  assert.equal(r.requestedTier, 'reasoning');
  assert.ok(r.fallbackReason);
});

test('tier-default: no host context uses the configured tier default', () => {
  const r = resolveEmbeddedModel({ requestedTier: 'fast' }, { env: NO_CREDS });
  assert.equal(r.resolutionSource, 'tier-default');
  assert.equal(r.requestedTier, 'fast');
  assert.ok(r.selectedModel);
  assert.equal(r.tierSource, 'default');
});

test('env tier override is reflected in tierSource', () => {
  const r = resolveEmbeddedModel({ requestedTier: 'reasoning' }, { env: { CX_MODEL_REASONING: 'anthropic/claude-opus-4-6' } });
  assert.equal(r.resolutionSource, 'tier-default');
  assert.equal(r.selectedModel, 'anthropic/claude-opus-4-6');
  assert.equal(r.tierSource, 'env');
});

test('config-error: unrecognized host context without cross-provider opt-in', () => {
  const r = resolveEmbeddedModel({ hostModel: 'mystery/model-x' }, { env: NO_CREDS });
  assert.equal(r.resolutionSource, 'config-error');
  assert.equal(r.selectedModel, null);
  assert.equal(r.requiresCredential, null);
  assert.equal(r.error.code, 'MODEL_UNRESOLVED');
  assert.ok(r.error.remediation);
  assert.ok(r.warnings.some((w) => w.includes('not a recognized provider family')));
});

test('cross-provider opt-in falls through to tier-default', () => {
  const r = resolveEmbeddedModel({ hostModel: 'mystery/model-x', allowCrossProviderFallback: true }, { env: NO_CREDS });
  assert.equal(r.resolutionSource, 'tier-default');
  assert.ok(r.selectedModel);
});

test('workflow-type hint selects a tier when none requested', () => {
  assert.equal(resolveEmbeddedModel({ workflowType: 'architecture-review' }, { env: NO_CREDS }).requestedTier, 'reasoning');
  assert.equal(resolveEmbeddedModel({ workflowType: 'evidence-ingest' }, { env: NO_CREDS }).requestedTier, 'fast');
  assert.equal(resolveEmbeddedModel({}, { env: NO_CREDS }).requestedTier, 'standard');
});

test('healthStatus is never fabricated as healthy', () => {
  const r = resolveEmbeddedModel({ hostModel: 'anthropic/claude-sonnet-4-6' }, { env: NO_CREDS });
  assert.equal(r.healthStatus, 'unknown');
  assert.equal(r.estimatedLimits, null);
});

test('capabilities are best-effort: unverifiable names surface as warnings', () => {
  const r = resolveEmbeddedModel({ hostModel: 'anthropic/claude-sonnet-4-6', capabilities: ['telepathy'] }, { env: NO_CREDS });
  assert.ok(Array.isArray(r.capabilitiesMatched));
  assert.ok(r.warnings.some((w) => w.includes('telepathy')));
});
