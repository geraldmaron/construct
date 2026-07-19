/**
 * Capability-owned contract validation and runtime enforcement.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findContract,
  validateContractsFile,
  validateHandoff,
} from '../../lib/contracts/validate.mjs';

test('the shipped capability-owned contracts validate cleanly', () => {
  const result = validateContractsFile();
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('findContract resolves nested contracts by id and participants', () => {
  assert.equal(findContract({ id: 'construct-to-orchestrator' })?.consumer, 'orchestrator');
  assert.equal(
    findContract({ producer: 'construct', consumer: 'orchestrator' })?.id,
    'construct-to-orchestrator',
  );
  assert.equal(findContract({ producer: 'construct', consumer: 'missing' }), null);
});

test('block mode rejects an incomplete canonical handoff', () => {
  const result = validateHandoff({
    producer: 'construct',
    consumer: 'orchestrator',
    artifact: { goal: 'do the thing' },
    enforcement: 'block',
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'BLOCKED_CONTRACT');
  assert.ok(result.errors.some((error) => error.includes('intent')));
});

test('warn mode reports but permits an incomplete canonical handoff', () => {
  const result = validateHandoff({
    producer: 'construct',
    consumer: 'orchestrator',
    artifact: { goal: 'do the thing' },
    enforcement: 'warn',
  });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((warning) => warning.includes('intent')));
});

test('block mode accepts a complete canonical handoff', () => {
  const result = validateHandoff({
    producer: 'construct',
    consumer: 'orchestrator',
    artifact: {
      goal: 'do the thing',
      intent: 'implement',
      workCategory: 'feature',
      riskFlags: {},
      acceptanceCriteria: ['ships'],
    },
    enforcement: 'block',
  });
  assert.equal(result.ok, true, result.errors?.join('; '));
});

test('unknown participants do not resolve through aliases', () => {
  const result = validateHandoff({
    producer: 'construct',
    consumer: 'legacy-orchestrator',
    artifact: {},
    enforcement: 'block',
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /no contract found/);
});
