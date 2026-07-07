/**
 * tests/model-router-local.test.mjs — ollama + local provider families
 * are recognised and surfaced in the dashboard catalog.
 *
 * @capability local.model.tier
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

  it('uses an ollama/* primary only as the user-owned standard tier', () => {
    const tiers = resolveTiersForPrimary('ollama/llama3.1:70b');
    assert.ok(tiers);
    assert.equal(tiers.reasoning, null);
    assert.equal(tiers.standard, 'ollama/llama3.1:70b');
    assert.equal(tiers.fast, null);
  });

  it('uses a local/* primary only as the user-owned standard tier', () => {
    const tiers = resolveTiersForPrimary('local/anything');
    assert.ok(tiers);
    assert.equal(tiers.reasoning, null);
    assert.equal(tiers.standard, 'local/anything');
    assert.equal(tiers.fast, null);
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

  it('accepts OLLAMA_HOST as a legacy configured-provider alias', () => {
    const catalog = getProviderModelCatalog({ env: { OLLAMA_HOST: 'http://127.0.0.1:11434' } });
    const ollama = catalog.providers.find((p) => p.id === 'ollama');
    assert.equal(ollama.configured, true);
  });

  it('includes ollama model ids in tierOptions', () => {
    const catalog = getProviderModelCatalog();
    assert.ok(catalog.tierOptions.reasoning.some((id) => id.startsWith('ollama/')));
    assert.ok(catalog.tierOptions.standard.some((id) => id.startsWith('ollama/')));
    assert.ok(catalog.tierOptions.fast.some((id) => id.startsWith('ollama/')));
  });
});
