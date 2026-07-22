/**
 * tests/roles/manifest.test.mjs — Worker Profile manifest loading and onboarding.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isOnboarded,
  listAllWorkerProfiles,
  listOnboardedWorkerProfiles,
  loadManifest,
} from '../../lib/roles/manifest.mjs';

test('loadManifest returns a manifest for operations', () => {
  const m = loadManifest('operations');
  assert.ok(m);
  assert.ok(m.events.length > 0);
  // operations's fence is the wide docs/** glob, which subsumes narrower
  // per-domain doc paths (runbooks, releases, etc.) rather than enumerating
  // each one — see the ADR-0065 appendix addendum.
  assert.ok(m.fence.allowedPaths.includes('docs/**'));
});

test('loadManifest accepts cx- prefix', () => {
  const a = loadManifest('operations');
  const b = loadManifest('cx-operations');
  assert.deepEqual(a, b);
});

test('isOnboarded is true only when events is non-empty', () => {
  assert.equal(isOnboarded('operations'), true);
  assert.equal(isOnboarded('qa'), true);
  assert.equal(isOnboarded('engineer'), true);
  assert.equal(isOnboarded('architect'), true);
  assert.equal(isOnboarded('nonexistent'), false);
});

test('listOnboardedWorkerProfiles includes the core roster', () => {
  const list = listOnboardedWorkerProfiles();
  const required = ['operations', 'qa', 'security', 'engineer', 'architect', 'debugger', 'product-manager', 'reviewer'];
  for (const id of required) {
    assert.ok(list.includes(id), `expected ${id} onboarded, got: ${list.join(', ')}`);
  }
  assert.ok(list.length >= required.length, `expected at least ${required.length} onboarded`);
});

test('listAllWorkerProfiles covers the canonical registry', () => {
  const all = listAllWorkerProfiles();
  assert.ok(all.includes('engineer'));
  assert.ok(all.includes('architect'));
  assert.ok(all.length >= 12);
});
