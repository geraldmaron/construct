/**
 * tests/oracle-invariants-registry.test.mjs — the Layer 1 invariant-registry framework
 * (lib/oracle/invariants/registry.mjs): shape of INVARIANTS, and runInvariants()'s
 * worst-status-wins rollup and per-invariant crash isolation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { INVARIANTS, LAYER1_INVARIANTS, LAYER2_INVARIANTS, runInvariants } from '../lib/oracle/invariants/registry.mjs';
import * as closedBeadShaReachable from '../lib/oracle/invariants/closed-bead-sha-reachable.mjs';
import * as dueDetectionDoesNotEqualCompletion from '../lib/oracle/invariants/due-detection-does-not-equal-completion.mjs';

function stubInvariant(id, status) {
  return { id, layer: 1, description: `stub ${id}`, check: async () => ({ status }) };
}

test('INVARIANTS is a frozen array of {id, layer, description, check} definitions', () => {
  assert.ok(Object.isFrozen(INVARIANTS));
  assert.ok(INVARIANTS.length >= 1);
  for (const inv of INVARIANTS) {
    assert.equal(typeof inv.id, 'string');
    assert.equal(typeof inv.layer, 'number');
    assert.equal(typeof inv.description, 'string');
    assert.equal(typeof inv.check, 'function');
  }
});

test('the headline invariant is registered', () => {
  assert.ok(INVARIANTS.includes(closedBeadShaReachable));
});

test('Layer 2 invariants are registered separately and included in INVARIANTS', () => {
  assert.ok(LAYER2_INVARIANTS.includes(dueDetectionDoesNotEqualCompletion));
  assert.ok(INVARIANTS.includes(dueDetectionDoesNotEqualCompletion));
  assert.equal(LAYER1_INVARIANTS.length + LAYER2_INVARIANTS.length, INVARIANTS.length);
});

test('runInvariants: all passed rolls up to overall passed', async () => {
  const result = await runInvariants({}, [stubInvariant('a', 'passed'), stubInvariant('b', 'passed')]);
  assert.equal(result.overall, 'passed');
  assert.equal(result.invariants.length, 2);
});

test('runInvariants: a single failed invariant rolls the whole run up to failed', async () => {
  const result = await runInvariants({}, [stubInvariant('a', 'passed'), stubInvariant('b', 'failed')]);
  assert.equal(result.overall, 'failed');
});

test('runInvariants: failed outranks collection-error and unknown', async () => {
  const result = await runInvariants({}, [
    stubInvariant('a', 'unknown'),
    stubInvariant('b', 'collection-error'),
    stubInvariant('c', 'failed'),
  ]);
  assert.equal(result.overall, 'failed');
});

test('runInvariants: collection-error outranks unknown when nothing failed', async () => {
  const result = await runInvariants({}, [stubInvariant('a', 'unknown'), stubInvariant('b', 'collection-error')]);
  assert.equal(result.overall, 'collection-error');
});

test('runInvariants: a throwing invariant is caught per-invariant and reported as collection-error, not crashed', async () => {
  const throwing = { id: 'throws', layer: 1, description: 'throws', check: async () => { throw new Error('boom'); } };
  const result = await runInvariants({}, [stubInvariant('a', 'passed'), throwing]);
  assert.equal(result.overall, 'collection-error');
  const thrown = result.invariants.find((r) => r.id === 'throws');
  assert.equal(thrown.status, 'collection-error');
  assert.match(thrown.detail, /boom/);
});

test('runInvariants: a throwing invariant does not prevent other invariants from reporting', async () => {
  const throwing = { id: 'throws', layer: 1, description: 'throws', check: async () => { throw new Error('boom'); } };
  const result = await runInvariants({}, [throwing, stubInvariant('b', 'passed')]);
  const clean = result.invariants.find((r) => r.id === 'b');
  assert.equal(clean.status, 'passed');
});

test('runInvariants against the real registry produces one result per invariant with id/layer/description attached', async () => {
  const result = await runInvariants({ listClosedBeads: () => [] });
  assert.equal(result.invariants.length, INVARIANTS.length);
  for (const r of result.invariants) {
    assert.equal(typeof r.id, 'string');
    assert.equal(typeof r.layer, 'number');
    assert.equal(typeof r.description, 'string');
    assert.equal(typeof r.status, 'string');
  }
});
