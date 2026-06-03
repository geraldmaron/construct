/**
 * tests/decisions-registry.test.mjs — decision registry build + validation.
 *
 * @enforces ADR-0015
 *
 * The registry is the spine of the enforcement/decision-durability program
 * (bead construct-wvbf.1): it indexes ADRs, contracts, and rules from source and
 * binds each to its enforcement via @enforces markers. These tests pin that the
 * view builds deterministically, parses ADR status/supersede edges, and
 * surfaces the advisory-vs-enforced split downstream gates depend on.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRegistry, validateRegistry, DECISION_STATUSES } from '../lib/decisions/registry.mjs';

test('registry indexes every ADR in docs/adr', () => {
  const { decisions } = buildRegistry();
  const adrs = decisions.filter((d) => d.kind === 'adr').map((d) => d.id);
  for (const id of ['ADR-0001', 'ADR-0002', 'ADR-0003', 'ADR-0015']) {
    assert.ok(adrs.includes(id), `expected registry to include ${id}`);
  }
});

test('ADR status parses into the canonical enum', () => {
  const { byId } = buildRegistry();
  const adr = byId.get('ADR-0002');
  assert.ok(adr, 'ADR-0002 present');
  assert.ok(DECISION_STATUSES.includes(adr.status), `status "${adr.status}" is canonical`);
});

test('contracts are indexed with their executable checks as enforcement', () => {
  const { decisions } = buildRegistry();
  const contracts = decisions.filter((d) => d.kind === 'contract');
  assert.ok(contracts.length > 0, 'at least one contract decision');
  const withChecks = contracts.filter((c) => c.enforcingChecks.length > 0);
  assert.ok(withChecks.length > 0, 'some contracts carry executable postcondition checks');
});

test('@enforces marker binds a test to a decision', () => {
  const { byId } = buildRegistry();
  const adr = byId.get('ADR-0015');
  assert.ok(adr, 'ADR-0015 present');
  assert.ok(
    adr.enforcingTests.some((t) => t.includes('decisions-registry.test.mjs')),
    'this test binds to ADR-0015 via @enforces and is discovered',
  );
  assert.equal(adr.advisory, false, 'a bound decision is not advisory');
});

test('supersededBy is the inverse of supersedes', () => {
  const { decisions, byId } = buildRegistry();
  for (const d of decisions) {
    if (d.supersedes) {
      const target = byId.get(d.supersedes);
      if (target) assert.equal(target.supersededBy, d.id, `${d.supersedes}.supersededBy === ${d.id}`);
    }
  }
});

test('buildRegistry is deterministic and id-ordered', () => {
  const a = buildRegistry().decisions.map((d) => d.id);
  const b = buildRegistry().decisions.map((d) => d.id);
  assert.deepEqual(a, b, 'two builds are identical');
  const sorted = [...a].sort();
  assert.deepEqual(a, sorted, 'decisions are ordered by id');
});

test('validateRegistry passes on the current tree', () => {
  const { ok, errors } = validateRegistry();
  assert.equal(ok, true, `registry should be structurally valid: ${errors.join('; ')}`);
});
