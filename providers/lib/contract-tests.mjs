/**
 * providers/lib/contract-tests.mjs — shared contract tests for any provider.
 *
 * Import and call runContractTests(provider) from a provider's own test file.
 * Uses node:test + node:assert — zero external deps.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validate, hasCapability, CAPABILITIES } from './interface.mjs';
import { CapabilityNotSupported } from './errors.mjs';

/**
 * Run the standard contract test suite against a provider instance.
 * Call this from your provider's test file:
 *
 *   import { runContractTests } from '../lib/contract-tests.mjs';
 *   import provider from './index.mjs';
 *   runContractTests(provider);
 */
export function runContractTests(provider) {
  describe(`Provider contract: ${provider?.name ?? 'unnamed'}`, () => {
    it('passes interface validation', () => {
      const result = validate(provider);
      assert.ok(result.valid, `Validation errors: ${result.errors.join('; ')}`);
    });

    it('has a non-empty string name', () => {
      assert.ok(typeof provider.name === 'string' && provider.name.length > 0);
    });

    it('declares capabilities as an array of known values', () => {
      assert.ok(Array.isArray(provider.capabilities));
      for (const cap of provider.capabilities) {
        assert.ok(CAPABILITIES.includes(cap), `Unknown capability: ${cap}`);
      }
    });

    it('implements a function for each declared capability', () => {
      for (const cap of provider.capabilities) {
        assert.equal(typeof provider[cap], 'function', `Missing function for capability "${cap}"`);
      }
    });

    it('implements init as a function', () => {
      assert.equal(typeof provider.init, 'function');
    });

    for (const cap of CAPABILITIES) {
      if (provider && Array.isArray(provider.capabilities) && !provider.capabilities.includes(cap)) {
        it(`does not claim unsupported capability "${cap}"`, () => {
          assert.ok(!hasCapability(provider, cap));
        });
      }
    }
  });
}
