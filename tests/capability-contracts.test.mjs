/**
 * Runtime tests for capability-owned contract queries.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAllContracts,
  getContractById,
  resolveContractChain,
  validatePacket,
} from '../lib/capability-contracts.mjs';

test('query view flattens capability-owned contracts without duplicates', () => {
  const contracts = getAllContracts();
  assert.ok(contracts.length > 0);
  assert.equal(new Set(contracts.map((contract) => contract.id)).size, contracts.length);
  assert.equal(getContractById('construct-to-orchestrator')?.consumer, 'orchestrator');
});

test('resolveContractChain filters by canonical Worker Profile participants', () => {
  const chain = resolveContractChain({
    track: 'orchestrated',
    workerProfiles: ['orchestrator'],
  });
  assert.deepEqual(chain.map((entry) => entry.contract.id), [
    'user-to-construct',
    'construct-to-orchestrator',
  ]);
});

test('validatePacket enforces required non-empty fields', () => {
  const result = validatePacket('construct-to-orchestrator', {
    goal: 'Harden contracts',
    intent: '',
    workCategory: 'feature',
    riskFlags: [],
    acceptanceCriteria: ['ships'],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['intent', 'riskFlags']);
});

test('unknown retired contract ids are rejected', () => {
  const result = validatePacket('engineer-to-reviewer', {}, 'output');
  assert.deepEqual(result, {
    ok: false,
    reason: 'contract-not-found',
    contractId: 'engineer-to-reviewer',
  });
});
