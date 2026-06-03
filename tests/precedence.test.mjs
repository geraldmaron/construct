/**
 * tests/precedence.test.mjs — rule precedence resolution and tier validation.
 *
 * @enforces ADR-0015
 *
 * Bead construct-wvbf.8: conflicting guidance resolves by an explicit tier order,
 * deterministically. These pin the ordering (safety beats style), the resolver,
 * and that a rule cannot declare a tier outside the canonical set.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PRECEDENCE_TIERS, tierRank, resolvePrecedence, validatePrecedenceTiersOn } from '../lib/decisions/precedence.mjs';
import { buildRegistry } from '../lib/decisions/registry.mjs';

test('safety outranks style and the order is total', () => {
  assert.ok(tierRank('safety') < tierRank('style'));
  assert.equal(resolvePrecedence('safety', 'style'), -1);
  assert.equal(resolvePrecedence('style', 'safety'), 1);
  assert.equal(resolvePrecedence('correctness', 'correctness'), 0);
});

test('an unknown tier ranks last', () => {
  assert.equal(tierRank('made-up'), Number.POSITIVE_INFINITY);
  assert.equal(resolvePrecedence('style', 'made-up'), -1);
});

test('seeded rules declare valid tiers and the live tree validates', () => {
  const { byId } = buildRegistry();
  assert.equal(byId.get('rule:common/no-fabrication').precedenceTier, 'correctness');
  assert.equal(byId.get('rule:common/comments').precedenceTier, 'style');
  const { ok, violations } = validatePrecedenceTiersOn(buildRegistry().decisions);
  assert.equal(ok, true, violations.join('; '));
});

test('a rule declaring an invalid tier is flagged', () => {
  const { ok, violations } = validatePrecedenceTiersOn([{ id: 'rule:x', precedenceTier: 'nonsense' }]);
  assert.equal(ok, false);
  assert.ok(violations.some((v) => /unknown precedence_tier/.test(v)));
});

test('every canonical tier is unique', () => {
  assert.equal(new Set(PRECEDENCE_TIERS).size, PRECEDENCE_TIERS.length);
});
