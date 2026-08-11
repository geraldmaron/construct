/**
 * tests/kernel/capabilities/postconditions.test.ts — the postcondition
 * machinery, exercised against an injected registry.
 *
 * The predecessor's five rules and the golden corpus that locked them are gone:
 * they were keyed to role names no dispatch emits, and three of those names
 * collided with catalog domains, so the "lock" was preserving behavior that
 * could only ever misfire. What is worth locking is the machinery a pack's own
 * rule will run under — the open-world default, and the refusal to let a
 * throwing rule count as a pass.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  POSTCONDITIONS,
  type PostconditionRule,
  describePostconditions,
  packetField,
  validateBinaryPostconditions,
} from '../../../src/kernel/capabilities/postconditions.ts';

const REGISTRY: Readonly<Record<string, readonly PostconditionRule[]>> = {
  'sample-domain': [
    {
      id: 'sample-domain.check-ran',
      description: 'The check must have run before handoff.',
      check: (p) => packetField(p, 'checkRan') === true,
      reason: 'checkRan must be true.',
    },
    {
      id: 'sample-domain.explodes',
      description: 'A rule that throws on a malformed packet.',
      check: (p) => (packetField(p, 'nested') as { deep: boolean }).deep,
      reason: 'nested.deep must be true.',
    },
  ],
};

test('no rules ship registered: a pack brings its own or the producer passes vacuously', () => {
  assert.deepEqual(Object.keys(POSTCONDITIONS), []);
  const result = validateBinaryPostconditions('product-scoping', {});
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test('a packet satisfying every rule passes', () => {
  const result = validateBinaryPostconditions(
    'sample-domain',
    { checkRan: true, nested: { deep: true } },
    REGISTRY,
  );
  assert.equal(result.ok, true);
  assert.equal(result.producer, 'sample-domain');
  assert.deepEqual(result.failures, []);
});

test('a truthy-but-not-true flag is a violation: going through the motions is not passing', () => {
  const result = validateBinaryPostconditions(
    'sample-domain',
    { checkRan: 'yes', nested: { deep: true } },
    REGISTRY,
  );
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.failures.map((f) => f.id),
    ['sample-domain.check-ran'],
  );
  for (const f of result.failures) {
    assert.ok(f.reason.trim().length > 0, `${f.id} must explain itself`);
  }
});

test('a rule that throws counts as unsatisfied, never as an escape hatch', () => {
  const result = validateBinaryPostconditions('sample-domain', { checkRan: true }, REGISTRY);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.failures.map((f) => f.id),
    ['sample-domain.explodes'],
  );
});

test('validation is total: no packet shape throws out of the validator', () => {
  for (const packet of [undefined, null, 0, '', [], { nested: null }]) {
    assert.doesNotThrow(() => validateBinaryPostconditions('sample-domain', packet, REGISTRY));
  }
});

test('describePostconditions reports the registered ids and nothing for an unregistered producer', () => {
  assert.deepEqual(
    describePostconditions('sample-domain', REGISTRY).map((p) => p.id),
    ['sample-domain.check-ran', 'sample-domain.explodes'],
  );
  assert.deepEqual(describePostconditions('nobody', REGISTRY), []);
  assert.deepEqual(describePostconditions('sample-domain'), []);
});

test('every registered rule is keyed to a name a dispatch can actually emit', async () => {
  const { DOMAINS } = await import('../../../src/kernel/implication/domains.ts');
  const dispatchable = new Set(DOMAINS.map((d) => d.domain));
  for (const producer of Object.keys(POSTCONDITIONS)) {
    assert.ok(
      dispatchable.has(producer),
      `"${producer}" has postconditions but no dispatch emits it — the rule can only misfire`,
    );
  }
});
