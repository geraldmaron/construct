/**
 * templates/provider-scaffold/health.test.mjs — scaffold health test template.
 *
 * Verifies that the scaffolded provider's health() function can be called and
 * returns a result with the expected shape. Replace the import path and add
 * real assertions once the provider is implemented.
 *
 * Placeholder: %%PROVIDER_NAME%%
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { create } from '../../lib/providers/%%PROVIDER_NAME%%/index.mjs';

describe('%%PROVIDER_NAME%% provider health', () => {
  it('health() returns an object with an ok field', async () => {
    const provider = create();
    const result = await provider.health();
    assert.ok(typeof result === 'object' && result !== null, 'health() must return an object');
    assert.ok('ok' in result, 'health() result must have an ok field');
    assert.ok(typeof result.ok === 'boolean', 'health().ok must be a boolean');
  });

  it('provider satisfies the contract shape', () => {
    const provider = create();
    assert.ok(provider.meta, 'provider must have a meta object');
    assert.equal(provider.meta.id, '%%PROVIDER_NAME%%');
    assert.ok(Array.isArray(provider.meta.capabilities), 'meta.capabilities must be an array');
    assert.ok(typeof provider.health === 'function', 'provider must export health()');
  });
});
