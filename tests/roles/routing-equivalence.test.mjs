/**
 * tests/roles/routing-equivalence.test.mjs — proves the consolidated
 * orchestration/routing-tables resolver (construct-b0nny.16) makes the same
 * routing decision as lib/roles/router.mjs's route()/ownerOf() for a
 * representative event set, across owned, unowned, and doc-artifact cases.
 * router.mjs now delegates to routing-tables.mjs internally, so this is also
 * a regression guard against that delegation silently drifting apart.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { route, ownerOf } from '../../lib/roles/router.mjs';
import { resolveEventOwner, ownerForEvent } from '../../lib/orchestration/routing-tables.mjs';

const REPRESENTATIVE_EVENTS = [
  'push_gate.fail',
  'service.down',
  'test.fail',
  'dep.cve',
  'secrets.detected',
  'pr.merged.no-docs',
  'adr.requested',
  'regression.detected',
  'backlog.stale',
  'pr.opened',
  'design.requested',
  'research.requested',
  'bug.assigned',
  'feature.assigned',
  'handoff.received',
  'unknown.event',
  'made.up',
  '',
];

test('resolveEventOwner and router.route agree on cxId/personaId for every representative event', () => {
  for (const type of REPRESENTATIVE_EVENTS) {
    const viaTable = resolveEventOwner({ type });
    const viaRouter = route({ type });
    assert.deepEqual(viaRouter, viaTable, `route() vs resolveEventOwner() diverged for "${type}"`);
  }
});

test('ownerForEvent and router.ownerOf agree for every representative event', () => {
  for (const type of REPRESENTATIVE_EVENTS) {
    assert.equal(ownerOf(type), ownerForEvent(type), `ownerOf() vs ownerForEvent() diverged for "${type}"`);
  }
});

test('a known-owned event resolves to a persona with a matching manifest on both paths', () => {
  const viaTable = resolveEventOwner({ type: 'push_gate.fail' });
  const viaRouter = route({ type: 'push_gate.fail' });
  assert.ok(viaTable, 'resolveEventOwner must resolve push_gate.fail');
  assert.equal(viaTable.personaId, 'operations');
  assert.equal(viaTable.cxId, 'cx-operations');
  assert.ok(viaTable.manifest.events.includes('push_gate.fail'));
  assert.deepEqual(viaRouter, viaTable);
});

test('an unrouted event returns null on both paths', () => {
  assert.equal(resolveEventOwner({ type: 'no.such.event' }), null);
  assert.equal(route({ type: 'no.such.event' }), null);
});

test('a missing type returns null on both paths without throwing', () => {
  assert.equal(resolveEventOwner({}), null);
  assert.equal(route({}), null);
  assert.equal(resolveEventOwner(null), null);
  assert.equal(route(null), null);
});
