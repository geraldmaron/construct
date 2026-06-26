/**
 * tests/contract-skill-hints.test.mjs — Optional contract skillHints routing path.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getContractSkillHints,
  resolveContractChain,
} from '../lib/specialist-contracts.mjs';

test('construct-to-orchestrator exposes skillHints without renaming contract ids', () => {
  const hints = getContractSkillHints('construct-to-orchestrator');
  assert.ok(hints.includes('ai/orchestration-workflow'));
  assert.ok(hints.includes('operating/orchestration-reference'));
});

test('resolveContractChain attaches skillHints alongside producer/consumer contract', () => {
  const chain = resolveContractChain({ track: 'orchestrated', specialists: ['cx-orchestrator'] });
  const entry = chain.find((item) => item.contract?.id === 'construct-to-orchestrator');
  assert.ok(entry, 'expected construct-to-orchestrator in chain');
  assert.ok(entry.skillHints.length >= 2);
  assert.equal(entry.contract.producer, 'construct');
  assert.equal(entry.contract.consumer, 'cx-orchestrator');
});
