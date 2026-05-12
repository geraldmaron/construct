/**
 * tests/roles/router.test.mjs — event → persona resolver.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { route, ownerOf } from '../../lib/roles/router.mjs';

test('route resolves push_gate.fail to cx-sre with manifest', () => {
  const r = route({ type: 'push_gate.fail' });
  assert.ok(r);
  assert.equal(r.personaId, 'sre');
  assert.equal(r.cxId, 'cx-sre');
  assert.ok(r.manifest.events.includes('push_gate.fail'));
});

test('route returns null for unknown events', () => {
  assert.equal(route({ type: 'unknown.event' }), null);
});

test('route returns null for events whose owner is not onboarded', () => {
  assert.equal(route({ type: 'bug.assigned' }), null);
});

test('ownerOf reflects EVENT_OWNERSHIP regardless of onboarding state', () => {
  assert.equal(ownerOf('test.fail'), 'cx-qa');
  assert.equal(ownerOf('dep.cve'), 'cx-security');
  assert.equal(ownerOf('pr.merged.no-docs'), 'cx-docs-keeper');
  assert.equal(ownerOf('made.up'), null);
});
