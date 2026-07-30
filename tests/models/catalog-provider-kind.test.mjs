/**
 * tests/models/catalog-provider-kind.test.mjs — model catalog bridged onto the
 * unified extension registry. Asserts model provider families are
 * discoverable as kind='model' manifests and surfaced by describeProviders(),
 * and that existing catalog visibility/cache behavior is untouched.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listModelProviderManifests,
  describeModelProviders,
  MODEL_MANIFEST_KIND,
  DEFAULT_MODELS_CONFIG,
  resolveModelsConfig,
  applyModelVisibilityFilter,
} from '../../lib/models/catalog.mjs';
import { describeProviders } from '../../lib/providers/registry.mjs';

test('MODEL_MANIFEST_KIND is "model"', () => {
  assert.equal(MODEL_MANIFEST_KIND, 'model');
});

test('listModelProviderManifests returns only kind=model manifests', () => {
  const manifests = listModelProviderManifests();
  assert.ok(manifests.length > 0, 'expected at least one kind=model manifest');
  for (const m of manifests) assert.equal(m.kind, 'model');
  const ids = manifests.map((m) => m.id);
  assert.ok(ids.includes('anthropic'));
  assert.ok(ids.includes('openrouter'));
  assert.ok(ids.includes('ollama'));
});

test('describeModelProviders reports configured status from secretEnvKeys', () => {
  const withKey = describeModelProviders({ env: { ANTHROPIC_API_KEY: 'sk-test' } });
  const anthropic = withKey.find((p) => p.id === 'anthropic');
  assert.ok(anthropic);
  assert.equal(anthropic.kind, 'model');
  assert.equal(anthropic.source, 'model-catalog');
  assert.equal(anthropic.health.ok, true);

  const withoutKey = describeModelProviders({ env: {}, allowAmbient: false });
  const anthropicUnconfigured = withoutKey.find((p) => p.id === 'anthropic');
  assert.equal(anthropicUnconfigured.health.ok, false);
});

test('describeProviders merges kind=model entries alongside data-source entries', async () => {
  const desc = await describeProviders({ rootDir: process.cwd(), env: process.env });
  const modelEntries = desc.summary.filter((e) => e.kind === 'model');
  assert.ok(modelEntries.length > 0, 'expected kind=model entries in describeProviders summary');
  assert.ok(modelEntries.some((e) => e.id === 'openrouter'));
});

test('resolveModelsConfig defaults are unchanged', () => {
  const resolved = resolveModelsConfig({});
  assert.deepEqual(resolved.visibility, DEFAULT_MODELS_CONFIG.visibility);
  assert.deepEqual(resolved.catalog, DEFAULT_MODELS_CONFIG.catalog);
});

test('applyModelVisibilityFilter still filters tier_defaults as before', () => {
  const catalog = {
    providers: [{
      id: 'anthropic',
      options: { reasoning: ['anthropic/claude-opus-4-6'], standard: ['anthropic/claude-sonnet-4-6'], fast: [] },
      tiers: {},
    }],
  };
  const result = applyModelVisibilityFilter(catalog, {
    visibility: { mode: 'tier_defaults', include: [], exclude: [], providers: {} },
    registryModels: { standard: 'anthropic/claude-sonnet-4-6' },
  });
  assert.ok(result.providers[0].options.standard.includes('anthropic/claude-sonnet-4-6'));
});
