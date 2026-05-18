/**
 * tests/model-router-local.test.mjs — ollama + local provider families
 * are recognised and surfaced in the dashboard catalog.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PROVIDER_FAMILY_TIERS,
  getProviderModelCatalog,
  resolveTiersForPrimary,
} from '../lib/model-router.mjs';

describe('PROVIDER_FAMILY_TIERS — local providers', () => {
  it('includes the ollama family tagged as local', () => {
    const family = PROVIDER_FAMILY_TIERS.find((f) => f.id === 'ollama');
    assert.ok(family, 'ollama family should be registered');
    assert.equal(family.local, true);
    assert.ok(family.requiresEnv?.includes('OLLAMA_BASE_URL'));
  });

  it('includes a generic local OpenAI-compatible family', () => {
    const family = PROVIDER_FAMILY_TIERS.find((f) => f.id === 'local');
    assert.ok(family);
    assert.equal(family.local, true);
    assert.ok(family.requiresEnv?.includes('LOCAL_LLM_BASE_URL'));
  });

  it('routes ollama/* model ids to the ollama family', () => {
    const tiers = resolveTiersForPrimary('ollama/llama3.1:70b');
    assert.ok(tiers);
    assert.match(tiers.reasoning, /^ollama\//);
    assert.match(tiers.standard, /^ollama\//);
    assert.match(tiers.fast, /^ollama\//);
  });

  it('routes local/* model ids to the local family', () => {
    const tiers = resolveTiersForPrimary('local/anything');
    assert.ok(tiers);
    assert.match(tiers.reasoning, /^local\//);
  });
});

describe('getProviderModelCatalog', () => {
  it('exposes local + requiresEnv flags on each provider entry', () => {
    const catalog = getProviderModelCatalog();
    const ollama = catalog.providers.find((p) => p.id === 'ollama');
    assert.equal(ollama.local, true);
    assert.deepEqual(ollama.requiresEnv, ['OLLAMA_BASE_URL']);
    assert.equal(typeof ollama.pricingHint, 'string');

    const remote = catalog.providers.find((p) => p.id === 'anthropic');
    assert.equal(remote.local, false);
    assert.deepEqual(remote.requiresEnv, []);
  });

  it('includes ollama model ids in tierOptions', () => {
    const catalog = getProviderModelCatalog();
    assert.ok(catalog.tierOptions.reasoning.some((id) => id.startsWith('ollama/')));
    assert.ok(catalog.tierOptions.standard.some((id) => id.startsWith('ollama/')));
    assert.ok(catalog.tierOptions.fast.some((id) => id.startsWith('ollama/')));
  });
});
