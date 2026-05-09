/**
 * agent-contracts.test.mjs — Runtime contract-chain enforcement tests.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveContractChain, validatePacket } from '../lib/agent-contracts.mjs';
import { EXECUTION_TRACKS, INTENT_CLASSES, WORK_CATEGORIES, routeRequest } from '../lib/orchestration-policy.mjs';

test('resolveContractChain excludes handoffs whose participants are not scheduled', () => {
  const chain = resolveContractChain({
    intent: INTENT_CLASSES.research,
    workCategory: WORK_CATEGORIES.quick,
    track: EXECUTION_TRACKS.immediate,
    specialists: [],
    riskFlags: {},
  });

  assert.deepEqual(chain.map((entry) => entry.contract.id), ['user-to-construct']);
});

test('routeRequest exposes only runnable contracts for immediate requests', () => {
  const route = routeRequest({
    request: 'explain how the caching layer works',
    fileCount: 1,
    moduleCount: 1,
  });

  assert.equal(route.track, EXECUTION_TRACKS.immediate);
  assert.deepEqual(route.contractChain.map((entry) => entry.contract.id), ['user-to-construct']);
});

test('routeRequest includes engineer review and QA contracts only when those agents are scheduled', () => {
  const route = routeRequest({
    request: 'build this feature end to end and ship it',
    fileCount: 4,
    moduleCount: 2,
  });

  const ids = route.contractChain.map((entry) => entry.contract.id);
  assert.ok(ids.includes('engineer-to-reviewer'));
  assert.ok(ids.includes('engineer-to-qa'));
});

test('validatePacket enforces required non-empty fields', () => {
  const result = validatePacket('architect-to-engineer', {
    goal: 'Harden contracts',
    approach: '',
    tasks: ['add validators'],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['approach', 'acceptanceCriteria']);
});
