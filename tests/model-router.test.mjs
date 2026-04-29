/**
 * model-router.test.mjs — Unit tests for lib/model-router.mjs tier resolution and failover logic.
 *
 * Covers: tier inference, free-model preference modes, cooldown tracking,
 * fallback candidate selection, and .env persistence.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { applyFreePreferenceToTierSet, applyFreeSameFamilyPreferenceToTierSet, classifyProviderFailure, inferTierModelsFromSelection, isProviderOnCooldown, readCurrentModels, readProviderCooldowns, resolveExecutionContractModelMetadata, resolveFallbackAction, selectFallbackModel, selectModelTierForWorkCategory, setModelWithTierInference, writeProviderCooldown } from '../lib/model-router.mjs';

function tempFile(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(dir, 'config.env');
}

test('inferTierModelsFromSelection derives anthropic family tiers', () => {
  const inferred = inferTierModelsFromSelection('anthropic/claude-sonnet-4-6', { registryModels: {} });
  assert.equal(inferred.reasoning, 'anthropic/claude-opus-4-6');
  assert.equal(inferred.standard, 'anthropic/claude-sonnet-4-6');
  assert.equal(inferred.fast, 'anthropic/claude-haiku-4-5-20251001');
});

test('setModelWithTierInference writes sibling tiers for same provider family', () => {
  const envPath = tempFile('construct-model-router-');
  const resolved = setModelWithTierInference(envPath, 'standard', 'openrouter/anthropic/claude-sonnet-4-6', {});
  assert.equal(resolved.reasoning, 'openrouter/anthropic/claude-opus-4-6');
  assert.equal(resolved.standard, 'openrouter/anthropic/claude-sonnet-4-6');
  assert.equal(resolved.fast, 'openrouter/anthropic/claude-haiku-4-5-20251001');

  const text = fs.readFileSync(envPath, 'utf8');
  assert.match(text, /CX_MODEL_REASONING=openrouter\/anthropic\/claude-opus-4-6/);
  assert.match(text, /CX_MODEL_STANDARD=openrouter\/anthropic\/claude-sonnet-4-6/);
  assert.match(text, /CX_MODEL_FAST=openrouter\/anthropic\/claude-haiku-4-5-20251001/);
});

test('readCurrentModels still respects explicit env overrides first', () => {
  const envPath = tempFile('construct-model-router-read-');
  fs.writeFileSync(envPath, 'CX_MODEL_REASONING=custom/reasoning\nCX_MODEL_STANDARD=custom/standard\n');

  const models = readCurrentModels(envPath, {
    reasoning: { primary: 'registry/reasoning' },
    standard: { primary: 'registry/standard' },
    fast: { primary: 'registry/fast' },
  });

  assert.equal(models.reasoning, 'custom/reasoning');
  assert.equal(models.standard, 'custom/standard');
  assert.equal(models.fast, 'registry/fast');
  assert.equal(models.sources.reasoning, 'env override');
  assert.equal(models.sources.fast, 'registry default');
});

test('readCurrentModels accepts process-style overrides in addition to env file values', () => {
  const envPath = tempFile('construct-model-router-process-');
  fs.writeFileSync(envPath, 'CX_MODEL_REASONING=file/reasoning\n');

  const models = readCurrentModels(envPath, {
    reasoning: { primary: 'registry/reasoning' },
    standard: { primary: 'registry/standard' },
    fast: { primary: 'registry/fast' },
  }, {
    CX_MODEL_STANDARD: 'process/standard',
    CX_MODEL_FAST: 'process/fast',
  });

  assert.equal(models.reasoning, 'file/reasoning');
  assert.equal(models.standard, 'process/standard');
  assert.equal(models.fast, 'process/fast');
  assert.equal(models.sources.reasoning, 'env override');
  assert.equal(models.sources.standard, 'env override');
  assert.equal(models.sources.fast, 'env override');
});

test('applyFreePreferenceToTierSet prefers free models where available', () => {
  const resolved = applyFreePreferenceToTierSet({
    reasoning: 'openrouter/qwen/qwen3-coder',
    standard: 'openrouter/qwen/qwen3-coder:free',
    fast: 'openrouter/qwen/qwen2.5-coder-32b-instruct',
  }, {
    registryModels: {
      reasoning: { primary: 'openrouter/deepseek/deepseek-r1' },
      standard: { primary: 'openrouter/qwen/qwen3-coder:free' },
      fast: { primary: 'openrouter/meta-llama/llama-3.3-70b-instruct:free' },
    },
  });

  assert.equal(resolved.reasoning, 'openrouter/qwen/qwen3-coder:free');
  assert.equal(resolved.standard, 'openrouter/qwen/qwen3-coder:free');
  assert.equal(resolved.fast, 'openrouter/qwen/qwen3-coder:free');
});

test('setModelWithTierInference preserves chosen tier while preferring free siblings', () => {
  const envPath = tempFile('construct-model-router-free-');
  const resolved = setModelWithTierInference(envPath, 'standard', 'openrouter/qwen/qwen3-coder:free', {
    reasoning: { primary: 'openrouter/deepseek/deepseek-r1' },
    standard: { primary: 'openrouter/qwen/qwen3-coder:free' },
    fast: { primary: 'openrouter/meta-llama/llama-3.3-70b-instruct:free' },
  }, { preferFree: true });

  assert.equal(resolved.standard, 'openrouter/qwen/qwen3-coder:free');
  assert.match(resolved.reasoning, /:free$|qwen3-coder:free/);
  assert.match(resolved.fast, /:free$/);
});

test('applyFreeSameFamilyPreferenceToTierSet only swaps to free siblings in the same family', () => {
  const resolved = applyFreeSameFamilyPreferenceToTierSet({
    reasoning: 'openrouter/qwen/qwen3-coder',
    standard: 'openrouter/qwen/qwen3-coder:free',
    fast: 'openrouter/qwen/qwen2.5-coder-32b-instruct',
  }, 'openrouter/qwen/qwen3-coder:free');

  assert.equal(resolved.reasoning, 'openrouter/qwen/qwen3-coder');
  assert.equal(resolved.standard, 'openrouter/qwen/qwen3-coder:free');
  assert.equal(resolved.fast, 'openrouter/qwen/qwen2.5-coder-32b-instruct');
});

test('setModelWithTierInference supports prefer-free-same-family mode', () => {
  const envPath = tempFile('construct-model-router-same-family-');
  const resolved = setModelWithTierInference(envPath, 'standard', 'openrouter/qwen/qwen3-coder:free', {
    reasoning: { primary: 'openrouter/deepseek/deepseek-r1' },
    standard: { primary: 'openrouter/qwen/qwen3-coder:free' },
    fast: { primary: 'openrouter/meta-llama/llama-3.3-70b-instruct:free' },
  }, { preferFreeSameFamily: true });

  assert.equal(resolved.standard, 'openrouter/qwen/qwen3-coder:free');
  assert.equal(resolved.reasoning, 'openrouter/qwen/qwen3-coder');
  assert.equal(resolved.fast, 'openrouter/qwen/qwen2.5-coder-32b-instruct');
});

test('selectModelTierForWorkCategory maps work categories to canonical model tiers', () => {
  assert.equal(selectModelTierForWorkCategory('deep'), 'reasoning');
  assert.equal(selectModelTierForWorkCategory('visual'), 'standard');
  assert.equal(selectModelTierForWorkCategory('quick'), 'fast');
  assert.equal(selectModelTierForWorkCategory('unknown'), null);
});

test('resolveExecutionContractModelMetadata exposes selected tier and tier sources', () => {
  const metadata = resolveExecutionContractModelMetadata({
    envValues: {
      CX_MODEL_STANDARD: 'custom/standard',
    },
    registryModels: {
      reasoning: { primary: 'registry/reasoning' },
      standard: { primary: 'registry/standard' },
      fast: { primary: 'registry/fast' },
    },
    requestedTier: 'standard',
    workCategory: 'analysis',
  });

  assert.equal(metadata.version, 'v1');
  assert.equal(metadata.workCategory, 'analysis');
  assert.equal(metadata.requestedTier, 'standard');
  assert.equal(metadata.selectedTier, 'standard');
  assert.equal(metadata.selectedModel, 'custom/standard');
  assert.equal(metadata.selectedModelSource, 'env override');
  assert.deepEqual(metadata.tiers, {
    reasoning: { model: 'registry/reasoning', source: 'registry default' },
    standard: { model: 'custom/standard', source: 'env override' },
    fast: { model: 'registry/fast', source: 'registry default' },
  });
});

test('classifyProviderFailure recognizes provider rate-limit and outage signals', () => {
  const rateLimit = classifyProviderFailure({ error: { message: '429 usage limit reached', provider: 'anthropic' } });
  const outage = classifyProviderFailure({ message: 'model unavailable', provider: 'openrouter' });

  assert.deepEqual(rateLimit, { kind: 'rate_limit', provider: 'anthropic', retryable: true });
  assert.deepEqual(outage, { kind: 'provider_unavailable', provider: 'openrouter', retryable: true });
});

test('resolveFallbackAction prefers a safe alternate provider when the current provider fails', () => {
  const action = resolveFallbackAction({
    failure: { kind: 'rate_limit', provider: 'anthropic', retryable: true },
    requestedTier: 'standard',
    currentModels: {
      standard: { model: 'anthropic/claude-sonnet-4-6' },
    },
    registryModels: {
      standard: { primary: 'openrouter/qwen/qwen3-coder:free', fallback: ['anthropic/claude-sonnet-4-6'] },
    },
  });

  assert.deepEqual(action, {
    action: 'apply-models',
    reason: 'rate_limit',
    targetModel: 'openrouter/qwen/qwen3-coder:free',
    tier: 'standard',
  });
});

test('resolveFallbackAction returns null when no safe alternate exists', () => {
  const action = resolveFallbackAction({
    failure: { kind: 'rate_limit', provider: 'anthropic', retryable: true },
    requestedTier: 'standard',
    currentModels: { standard: { model: 'anthropic/claude-sonnet-4-6' } },
    registryModels: { standard: { primary: 'anthropic/claude-sonnet-4-6', fallback: ['anthropic/claude-opus-4-6'] } },
  });

  assert.equal(action, null);
});

test('classifyProviderFailure handles transient network and auth errors', () => {
  const network = classifyProviderFailure({ message: 'fetch failed: network error' });
  const auth = classifyProviderFailure({ error: { message: 'invalid api key' } });

  assert.deepEqual(network, { kind: 'transient_network', provider: null, retryable: true });
  assert.deepEqual(auth, { kind: 'auth_error', provider: null, retryable: false });
});

test('readProviderCooldowns returns empty object for missing file', () => {
  const result = readProviderCooldowns('/nonexistent/path/cooldowns.json');
  assert.deepEqual(result, {});
});

test('writeProviderCooldown persists expiry; isProviderOnCooldown reflects it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-cooldown-'));
  const cooldownPath = path.join(dir, 'provider-cooldowns.json');
  const now = Date.now();

  writeProviderCooldown(cooldownPath, 'anthropic', now);

  assert.ok(isProviderOnCooldown(cooldownPath, 'anthropic', now + 1000), 'should be on cooldown 1s later');
  assert.ok(!isProviderOnCooldown(cooldownPath, 'anthropic', now + 6 * 60 * 1000), 'should be clear after 6 min');
  assert.ok(!isProviderOnCooldown(cooldownPath, 'openrouter', now + 1000), 'unrelated provider not on cooldown');
});

test('isProviderOnCooldown returns false for missing file', () => {
  assert.ok(!isProviderOnCooldown('/nonexistent/path/cooldowns.json', 'anthropic'));
});

test('selectFallbackModel resolves candidate and skips cooldown-blocked providers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-fallback-'));
  const envPath = path.join(dir, '.env');
  const cooldownPath = path.join(dir, 'provider-cooldowns.json');
  const now = Date.now();

  fs.writeFileSync(envPath, 'CX_MODEL_STANDARD=anthropic/claude-sonnet-4-6\n');

  const registryModels = {
    standard: { primary: 'anthropic/claude-sonnet-4-6', fallback: ['openrouter/qwen/qwen3-coder:free'] },
  };

  const hookInput = { error: { message: '429 rate limit', provider: 'anthropic' } };

  const result = selectFallbackModel({ hookInput, envPath, cooldownPath, registryModels, now });
  assert.ok(result, 'should resolve a candidate');
  assert.equal(result.tier, 'standard');
  assert.equal(result.targetModel, 'openrouter/qwen/qwen3-coder:free');
  assert.equal(result.reason, 'rate_limit');
});

test('selectFallbackModel returns null when failing provider is on cooldown', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-fallback-cd-'));
  const envPath = path.join(dir, '.env');
  const cooldownPath = path.join(dir, 'provider-cooldowns.json');
  const now = Date.now();

  fs.writeFileSync(envPath, 'CX_MODEL_STANDARD=anthropic/claude-sonnet-4-6\n');
  writeProviderCooldown(cooldownPath, 'anthropic', now);

  const hookInput = { error: { message: '429 rate limit', provider: 'anthropic' } };
  const result = selectFallbackModel({ hookInput, envPath, cooldownPath, now: now + 1000 });
  assert.equal(result, null);
});

test('selectFallbackModel returns null for non-retryable failures', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-fallback-auth-'));
  const envPath = path.join(dir, '.env');
  const cooldownPath = path.join(dir, 'provider-cooldowns.json');

  fs.writeFileSync(envPath, 'CX_MODEL_STANDARD=anthropic/claude-sonnet-4-6\n');

  const hookInput = { error: { message: 'invalid api key' } };
  const result = selectFallbackModel({ hookInput, envPath, cooldownPath });
  assert.equal(result, null);
});
