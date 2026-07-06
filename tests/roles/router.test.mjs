/**
 * tests/roles/router.test.mjs — event → persona resolver.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { route, ownerOf } from '../../lib/roles/router.mjs';

test('route resolves push_gate.fail to cx-operations with manifest', () => {
  const r = route({ type: 'push_gate.fail' });
  assert.ok(r);
  assert.equal(r.personaId, 'operations');
  assert.equal(r.cxId, 'cx-operations');
  assert.ok(r.manifest.events.includes('push_gate.fail'));
});

test('route returns null for unknown events', () => {
  assert.equal(route({ type: 'unknown.event' }), null);
});

test('route resolves bug.assigned to cx-engineer', () => {
  const r = route({ type: 'bug.assigned' });
  assert.ok(r, 'bug.assigned must route');
  assert.equal(r.cxId, 'cx-engineer');
});

test('ownerOf reflects EVENT_OWNERSHIP regardless of onboarding state', () => {
  assert.equal(ownerOf('test.fail'), 'cx-qa');
  assert.equal(ownerOf('dep.cve'), 'cx-security');
  assert.equal(ownerOf('pr.merged.no-docs'), 'cx-operations');
  assert.equal(ownerOf('made.up'), null);
});
