/**
 * tests/execution-capability-profile.test.mjs — unified capability record (construct-6zga.1.8).
 *
 * Proves the profile is keyed and versioned (AC1), every capability carries an
 * evidence source/confidence and honors operator override (AC2), unknown models
 * compile to conservative defaults with a degraded flag (AC3), the name/size
 * heuristic survives only as a tagged compatibility fallback (AC4), and chat and
 * specialist composition derive the SAME values the legacy heuristics produced —
 * the single resolved record, behavior preserved (AC5).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXECUTION_PROFILE_SCHEMA_VERSION,
  resolveExecutionCapabilityProfile,
  capabilityTierFromProfile,
  operatingProfileIdFromProfile,
  validateExecutionCapabilityProfile,
  providerGroupForModel,
} from '../lib/models/execution-capability-profile.mjs';
import { resolveCapabilityTier, resolveModelOperatingProfile } from '../lib/model-router.mjs';

const NOW = () => '2026-06-21T00:00:00.000Z';
const MODELS = [
  'anthropic/claude-opus-4-6',
  'openai/gpt-5.1',
  'openrouter/qwen/qwen3-coder:free',
  'ollama/llama3.1:8b',
  'ollama/devstral:24b',
  'local/custom-large',
  'github-copilot/gpt-5.5',
  'mystery/x',
];

test('AC1: profile is versioned, keyed, and schema-valid for every model', () => {
  for (const model of MODELS) {
    const p = resolveExecutionCapabilityProfile({ model, now: NOW });
    const { valid, errors } = validateExecutionCapabilityProfile(p);
    assert.ok(valid, `${model}: ${errors.join('; ')}`);
    assert.equal(p.schemaVersion, EXECUTION_PROFILE_SCHEMA_VERSION);
    assert.equal(p.key.provider, providerGroupForModel(model));
    assert.equal(p.key.requestedModel, model);
    assert.equal(p.key.resolvedModel, model);
    assert.ok(p.key.adapterProtocol);
    assert.equal(p.key.observedAt, '2026-06-21T00:00:00.000Z');
  }
});

test('AC2: every capability carries a source + confidence', () => {
  const p = resolveExecutionCapabilityProfile({ model: 'anthropic/claude-opus-4-6', now: NOW });
  for (const [name, f] of Object.entries(p.capabilities)) {
    assert.ok(['provider_metadata', 'live_probe', 'operator_override', 'compatibility_fallback', 'unknown'].includes(f.source), `${name}.source ${f.source}`);
    assert.ok(['high', 'medium', 'low', 'none'].includes(f.confidence), `${name}.confidence ${f.confidence}`);
  }
});

test('AC2: operator override wins and is tagged operator_override', () => {
  const overrides = { 'ollama/llama3.1:8b': { contextWindow: 8192, capabilityTier: 'mid' } };
  const p = resolveExecutionCapabilityProfile({ model: 'ollama/llama3.1:8b', overrides, now: NOW });
  assert.equal(p.capabilities.contextWindow.value, 8192);
  assert.equal(p.capabilities.contextWindow.source, 'operator_override');
  assert.equal(p.capabilities.contextWindow.confidence, 'high');
  assert.equal(p.capabilities.capabilityTier.value, 'mid');
  assert.equal(p.capabilities.capabilityTier.source, 'operator_override');
});

test('AC3: an unknown model compiles to conservative defaults with degraded=true', () => {
  const p = resolveExecutionCapabilityProfile({ model: 'mystery/x', now: NOW });
  assert.equal(p.capabilityClass, 'unknown');
  assert.equal(p.degraded, true);
  assert.equal(p.capabilities.structuredOutput.value, false);
  assert.equal(p.capabilities.cacheControl.value, false);
});

test('AC4: tier and operating profile are tagged compatibility_fallback when unmeasured', () => {
  const p = resolveExecutionCapabilityProfile({ model: 'ollama/llama3.1:8b', overrides: {}, now: NOW });
  assert.equal(p.capabilities.capabilityTier.source, 'compatibility_fallback');
  assert.equal(p.capabilities.operatingProfileId.source, 'compatibility_fallback');
});

test('AC5: chat and specialist composition derive the same values the heuristics produced', () => {
  for (const model of MODELS) {
    const p = resolveExecutionCapabilityProfile({ model, overrides: {}, now: NOW });
    assert.equal(
      capabilityTierFromProfile(p),
      resolveCapabilityTier({ model }),
      `tier mismatch for ${model}`,
    );
    assert.equal(
      operatingProfileIdFromProfile(p),
      resolveModelOperatingProfile({ selectedModel: model }).id,
      `operating profile mismatch for ${model}`,
    );
  }
});

test('AC5: env operating-profile override flows through the profile', () => {
  const p = resolveExecutionCapabilityProfile({
    model: 'anthropic/claude-opus-4-6',
    envValues: { CONSTRUCT_MODEL_PROFILE: 'small' },
    overrides: {},
    now: NOW,
  });
  assert.equal(operatingProfileIdFromProfile(p), 'small');
});

test('vendor adapters tag caps provider_metadata; non-vendor tag compatibility_fallback', () => {
  const vendor = resolveExecutionCapabilityProfile({ model: 'anthropic/claude-opus-4-6', overrides: {}, now: NOW });
  assert.equal(vendor.capabilities.structuredOutput.source, 'provider_metadata');
  const nonVendor = resolveExecutionCapabilityProfile({ model: 'ollama/llama3.1:8b', overrides: {}, now: NOW });
  assert.equal(nonVendor.capabilities.structuredOutput.source, 'compatibility_fallback');
});

test('profile is frozen and JSON-serializable', () => {
  const p = resolveExecutionCapabilityProfile({ model: 'anthropic/claude-opus-4-6', now: NOW });
  assert.ok(Object.isFrozen(p));
  assert.ok(Object.isFrozen(p.capabilities));
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(p)));
});

test('validateExecutionCapabilityProfile rejects malformed records', () => {
  assert.equal(validateExecutionCapabilityProfile(null).valid, false);
  assert.equal(validateExecutionCapabilityProfile({ schemaVersion: 999, key: {}, capabilities: {}, degraded: false, evidenceSources: [] }).valid, false);
});
