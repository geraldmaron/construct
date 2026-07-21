/**
 * Capability-owned contract coverage and postcondition classification.
 */

import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadRegistry } from '../lib/registry/loader.mjs';
import { computePostconditionCoverage } from '../lib/contracts/coverage.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function capabilityContracts(registry) {
  return Object.values(registry.capabilities || {})
    .flatMap((capability) => Object.values(capability.contracts || {}));
}

test('contracts are nested under capabilities and use canonical Worker Profile ids', () => {
  const registry = loadRegistry({ rootDir: REPO_ROOT, skipValidation: true });
  assert.equal('contracts' in registry, false);
  const contracts = capabilityContracts(registry);
  assert.ok(contracts.length > 0);

  const known = new Set(Object.keys(registry.workerProfiles || {}));
  const wellKnownProducers = new Set(['user', 'oncall', 'incident-system', '*', 'construct']);
  const wellKnownConsumers = new Set(['user', 'construct']);
  for (const contract of contracts) {
    assert.ok(wellKnownProducers.has(contract.producer) || known.has(contract.producer), `${contract.id}: unknown producer ${contract.producer}`);
    assert.ok(wellKnownConsumers.has(contract.consumer) || known.has(contract.consumer), `${contract.id}: unknown consumer ${contract.consumer}`);
    assert.match(contract.producer, /^(?:\*|[a-z0-9]+(?:-[a-z0-9]+)*)$/);
    assert.match(contract.consumer, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  }
});

test('contract ids and capability map keys agree', () => {
  const registry = loadRegistry({ rootDir: REPO_ROOT, skipValidation: true });
  const definitions = new Map();
  for (const capability of Object.values(registry.capabilities || {})) {
    for (const [key, contract] of Object.entries(capability.contracts || {})) {
      assert.match(contract.id, /^[a-z0-9][a-z0-9-]*$/);
      assert.equal(key, contract.id);
      if (definitions.has(contract.id)) assert.deepEqual(contract, definitions.get(contract.id));
      else definitions.set(contract.id, contract);
    }
  }
});

test('every contract postcondition is classified', () => {
  const registry = loadRegistry({ rootDir: REPO_ROOT, skipValidation: true });
  const offenders = [];
  for (const contract of capabilityContracts(registry)) {
    for (const [index, postcondition] of (contract.postconditions || []).entries()) {
      if (!postcondition || !['executable', 'advisory'].includes(postcondition.postconditionType)) {
        offenders.push(`${contract.id}[${index}]`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('postcondition coverage measures the unique capability-owned contract set', () => {
  const registry = loadRegistry({ rootDir: REPO_ROOT, skipValidation: true });
  const uniqueIds = new Set(capabilityContracts(registry).map((contract) => contract.id));
  const coverage = computePostconditionCoverage({ repoRoot: REPO_ROOT });
  assert.equal(coverage.contractCount, uniqueIds.size);
  assert.equal(coverage.unclassified, 0);
  assert.ok(coverage.total > 0);
});
