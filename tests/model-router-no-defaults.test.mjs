/**
 * tests/model-router-no-defaults.test.mjs — verify Construct ships with no
 * implicit model defaults. When nothing is configured, every tier resolves
 * to `null` with source `not configured`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  readCurrentModels,
  resolveExecutionContractModelMetadata,
  applyFreePreferenceToTierSet,
} from '../lib/model-router.mjs';
import { loadRegistry } from '../lib/registry/loader.mjs';

function tempFile() {
  return path.join(os.tmpdir(), `cx-router-nodef-${Date.now()}-${Math.random().toString(36).slice(2)}.env`);
}

test('readCurrentModels returns null for every tier when nothing is configured', () => {
  const envPath = tempFile();
  // No file, no registry — the clean-install state.
  const models = readCurrentModels(envPath, {});
  assert.equal(models.reasoning, null);
  assert.equal(models.standard, null);
  assert.equal(models.fast, null);
  for (const t of ['reasoning', 'standard', 'fast']) {
    assert.equal(models.sources[t], 'not configured');
  }
});

test('readCurrentModels reports `registry` source when only the registry has a primary', () => {
  const envPath = tempFile();
  const models = readCurrentModels(envPath, { reasoning: { primary: 'anthropic/claude-opus-4-6' } });
  assert.equal(models.reasoning, 'anthropic/claude-opus-4-6');
  assert.equal(models.sources.reasoning, 'registry');
  assert.equal(models.standard, null);
  assert.equal(models.sources.standard, 'not configured');
});

test('resolveExecutionContractModelMetadata exposes null model when nothing is configured', () => {
  const meta = resolveExecutionContractModelMetadata({
    envValues: {},
    registryModels: {},
    requestedTier: 'reasoning',
  });
  assert.equal(meta.selectedModel, null);
  assert.equal(meta.selectedModelSource, 'not configured');
});

test('applyFreePreferenceToTierSet does not invent a model when neither tierSet nor registry has one', () => {
  const resolved = applyFreePreferenceToTierSet(
    { reasoning: null, standard: null, fast: null },
    { registryModels: {} },
  );
  assert.equal(resolved.reasoning, null);
  assert.equal(resolved.standard, null);
  assert.equal(resolved.fast, null);
});

test('shipped registry has no preselected primaries', () => {
  const registry = loadRegistry({ rootDir: process.cwd() });
  for (const tier of ['reasoning', 'standard', 'fast']) {
    assert.equal(registry.models?.[tier]?.primary ?? null, null, `tier ${tier} ships with a primary — should be null`);
  }
});
