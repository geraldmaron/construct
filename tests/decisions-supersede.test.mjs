/**
 * tests/decisions-supersede.test.mjs — supersede-chain validation gate.
 *
 * @enforces ADR-0015
 *
 * The supersede edge is how a decision is consciously replaced rather than
 * silently reversed (bead construct-wvbf.3). These pin the four failure classes
 * over synthetic registries and confirm the live tree is clean.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkSupersessionOn, checkSupersession } from '../lib/decisions/registry.mjs';

const d = (id, status, supersedes = null) => ({ id, status, supersedes });

test('a valid supersede pair passes', () => {
  const { ok } = checkSupersessionOn([d('ADR-0001', 'superseded'), d('ADR-0002', 'accepted', 'ADR-0001')]);
  assert.equal(ok, true);
});

test('superseding an unknown decision fails', () => {
  const { ok, violations } = checkSupersessionOn([d('ADR-0002', 'accepted', 'ADR-9999')]);
  assert.equal(ok, false);
  assert.ok(violations.some((v) => /unknown decision ADR-9999/.test(v)));
});

test('superseding a target not marked superseded fails', () => {
  const { ok, violations } = checkSupersessionOn([d('ADR-0001', 'accepted'), d('ADR-0002', 'accepted', 'ADR-0001')]);
  assert.equal(ok, false);
  assert.ok(violations.some((v) => /expected superseded/.test(v)));
});

test('a superseded decision that nothing supersedes fails', () => {
  const { ok, violations } = checkSupersessionOn([d('ADR-0001', 'superseded')]);
  assert.equal(ok, false);
  assert.ok(violations.some((v) => /no decision supersedes it/.test(v)));
});

test('a supersede cycle is detected', () => {
  const { ok, violations } = checkSupersessionOn([
    d('ADR-0001', 'superseded', 'ADR-0002'),
    d('ADR-0002', 'superseded', 'ADR-0001'),
  ]);
  assert.equal(ok, false);
  assert.ok(violations.some((v) => /cycle/.test(v)));
});

test('the live decision tree has valid supersede chains', () => {
  const { ok, violations } = checkSupersession();
  assert.equal(ok, true, violations.join('; '));
});
