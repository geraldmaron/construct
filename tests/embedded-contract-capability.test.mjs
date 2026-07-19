/**
 * embedded-contract-capability.test.mjs — canonical Construct contract coverage.
 *
 * Assertions pin the clean-slate public model and reject retired terminology.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCapabilityContract } from '../lib/embedded-contract/capability.mjs';
import { PROCEDURE_IDS } from '../lib/embedded-contract/procedure-definitions.mjs';
import { collectSecretValues, assertNoSecrets } from '../lib/embedded-contract/redaction.mjs';
import { loadRegistry } from '../lib/registry/loader.mjs';

test('capability discovery uses canonical Worker Profile and Procedure sections', () => {
  const contract = buildCapabilityContract({ env: {} });
  assert.ok(contract.workerProfiles.length > 0);
  assert.ok(contract.procedures.length > 0);
  assert.ok(!('roles' in contract));
  assert.ok(!('workflows' in contract));
  assert.deepEqual(contract.workerProfiles.map((entry) => entry.id).sort(), Object.keys(loadRegistry().workerProfiles).sort());
  assert.deepEqual(contract.procedures.map((entry) => entry.id).sort(), [...PROCEDURE_IDS].sort());
});

test('capability discovery never leaks credentials', () => {
  const env = { ANTHROPIC_API_KEY: 'cred-canary-capability-0001' };
  const contract = buildCapabilityContract({ env });
  assert.ok(collectSecretValues(env).has(env.ANTHROPIC_API_KEY));
  assert.doesNotThrow(() => assertNoSecrets(contract, { env }));
});
