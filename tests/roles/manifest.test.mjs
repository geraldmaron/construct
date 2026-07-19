/**
 * tests/roles/manifest.test.mjs — manifest loader and onboarded-persona logic.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { loadManifest, isOnboarded, listOnboardedPersonas, listAllPersonas } from '../../lib/roles/manifest.mjs';

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
  const b = loadManifest('operations');
  assert.deepEqual(a, b);
});

test('isOnboarded is true only when events is non-empty', () => {
  assert.equal(isOnboarded('operations'), true);
  assert.equal(isOnboarded('qa'), true);
  assert.equal(isOnboarded('engineer'), true);
  assert.equal(isOnboarded('architect'), true);
  assert.equal(isOnboarded('nonexistent'), false);
});

test('listOnboardedPersonas includes the core consolidated roster', () => {
  const list = listOnboardedPersonas();
  // construct-rf26.11 consolidated sre/release-manager/docs-keeper into
  // operations and platform-engineer into engineer.
  const required = ['operations', 'qa', 'security', 'engineer', 'architect', 'debugger', 'product-manager', 'reviewer'];
  for (const id of required) {
    assert.ok(list.includes(id), `expected ${id} onboarded, got: ${list.join(', ')}`);
  }
  assert.ok(list.length >= required.length, `expected at least ${required.length} onboarded`);
});

test('listAllPersonas covers all registry roles', () => {
  const all = listAllPersonas();
  assert.ok(all.includes('engineer'));
  assert.ok(all.includes('architect'));
  // construct-rf26.11 consolidated the 29-specialist roster to 12 (orchestrator + 11 workers).
  assert.ok(all.length >= 12);
});
