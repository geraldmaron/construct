/**
 * tests/functional/model-catalog-visibility.functional.test.mjs — project config
 * models.visibility filter applied through getProviderModelCatalog.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getProviderModelCatalog } from '../../lib/model-router.mjs';
import {
  applyModelVisibilityFilter,
  mergeLiveModelsIntoProviders,
  writeLiveCatalogCache,
} from '../../lib/models/catalog.mjs';
import { doctorRoot } from '../../lib/config/xdg.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

function withProject(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-catalog-'));
  fs.writeFileSync(path.join(root, 'construct.config.json'), JSON.stringify({
    version: 1,
    alias: 'Test',
    models: {
      visibility: {
        mode: 'explicit',
        include: ['anthropic/claude-sonnet-4-6'],
        exclude: [],
        providers: { anthropic: true },
      },
    },
  }, null, 2));
  try {
    return fn(root);
  } finally {
    rmTmpDir(root);
  }
}

test('getProviderModelCatalog applies explicit visibility from construct.config.json', () => {
  withProject((root) => {
    const env = { ANTHROPIC_API_KEY: 'sk-test', OPENROUTER_API_KEY: 'sk-or' };
    const catalog = getProviderModelCatalog({ env, cwd: root });
    const allIds = catalog.tierOptions.standard;
    assert.ok(allIds.includes('anthropic/claude-sonnet-4-6'));
    assert.equal(allIds.some((id) => id.startsWith('openrouter/')), false);
  });
});

test('mergeLiveModelsIntoProviders adds cached free models to openrouter family', () => {
  const providers = [{
    id: 'openrouter',
    options: { reasoning: [], standard: ['openrouter/qwen/qwen3-coder:free'], fast: [] },
    tiers: {},
  }];
  const merged = mergeLiveModelsIntoProviders(providers, [
    { id: 'openrouter/openrouter/free', name: 'Free Router' },
  ], { maxLiveFree: 24 });
  assert.ok(merged[0].options.standard.includes('openrouter/openrouter/free'));
});

test('activeModelId bypasses explicit visibility exclude for pinned model', () => {
  const filtered = applyModelVisibilityFilter(
    {
      providers: [{
        id: 'openrouter',
        options: {
          reasoning: ['openrouter/hidden/model'],
          standard: ['openrouter/hidden/model'],
          fast: ['openrouter/hidden/model'],
        },
        tiers: {},
      }],
    },
    {
      visibility: { mode: 'explicit', include: ['anthropic/claude-sonnet-4-6'], exclude: [], providers: {} },
      activeModelId: 'openrouter/hidden/model',
    },
  );
  assert.ok(filtered.tierOptions.standard.includes('openrouter/hidden/model'));
});

test('writeLiveCatalogCache persists models for sync read', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-cache-'));
  try {
    writeLiveCatalogCache([{ id: 'openrouter/openrouter/free', name: 'Free' }], { homeDir: home });
    const file = path.join(doctorRoot(home), 'model-catalog-cache.json');
    assert.ok(fs.existsSync(file));
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(parsed.models[0].id, 'openrouter/openrouter/free');
  } finally {
    rmTmpDir(home);
  }
});
