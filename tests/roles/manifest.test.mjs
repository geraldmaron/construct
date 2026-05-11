/**
 * tests/roles/manifest.test.mjs — manifest loader and onboarded-persona logic.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { loadManifest, isOnboarded, listOnboardedPersonas, listAllPersonas } from '../../lib/roles/manifest.mjs';

test('loadManifest returns a manifest for sre', () => {
  const m = loadManifest('sre');
  assert.ok(m);
  assert.ok(m.events.length > 0);
  assert.ok(m.fence.allowedPaths.includes('docs/runbooks/**'));
});

test('loadManifest accepts cx- prefix', () => {
  const a = loadManifest('cx-sre');
  const b = loadManifest('sre');
  assert.deepEqual(a, b);
});

test('isOnboarded is true only when events is non-empty', () => {
  assert.equal(isOnboarded('sre'), true);
  assert.equal(isOnboarded('qa'), true);
  assert.equal(isOnboarded('engineer'), true);
  assert.equal(isOnboarded('architect'), false);
  assert.equal(isOnboarded('nonexistent'), false);
});

test('listOnboardedPersonas includes the v1 four plus engineer (Phase C)', () => {
  const list = listOnboardedPersonas().sort();
  assert.deepEqual(list, ['docs-keeper', 'engineer', 'qa', 'security', 'sre']);
});

test('listAllPersonas covers all registry roles', () => {
  const all = listAllPersonas();
  assert.ok(all.includes('engineer'));
  assert.ok(all.includes('architect'));
  assert.ok(all.length >= 27);
});
