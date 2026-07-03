/**
 * tests/mode-health-single-source.test.mjs — single-source invariant for mode capability health.
 *
 * Proves that lib/mode-capabilities.mjs is the sole place a capability must be declared
 * for it to appear in both getModeCapabilityStatus() and buildStatus()
 * (deployment.capabilityStatus / deployment.unsupportedCapabilities). Adding a capability to
 * the registry — without touching status.mjs or bin/construct — must surface everywhere.
 */

import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  getModeCapabilityStatus,
  getUnsupportedCapabilities,
  _injectCapabilityForTesting,
  CAPABILITY_STATUSES,
  CAPABILITY_REGISTRY,
} from '../lib/mode-capabilities.mjs';

import { buildStatus } from '../lib/status.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');

test('CAPABILITY_STATUSES exports known values', () => {
  assert.ok(Array.isArray(CAPABILITY_STATUSES));
  assert.ok(CAPABILITY_STATUSES.includes('implemented'));
  assert.ok(CAPABILITY_STATUSES.includes('not-implemented'));
  assert.ok(CAPABILITY_STATUSES.length >= 2);
});

test('CAPABILITY_REGISTRY covers solo, team, enterprise modes', () => {
  for (const mode of ['solo', 'team', 'enterprise']) {
    assert.ok(Array.isArray(CAPABILITY_REGISTRY[mode]), `${mode}: must be an array`);
    assert.ok(CAPABILITY_REGISTRY[mode].length > 0, `${mode}: must declare at least one capability`);
    for (const cap of CAPABILITY_REGISTRY[mode]) {
      assert.ok(typeof cap.id === 'string' && cap.id.length > 0, 'each capability must have an id');
      assert.ok(CAPABILITY_STATUSES.includes(cap.status), `${cap.id}.status='${cap.status}' must be a known value`);
    }
  }
});

test('getModeCapabilityStatus returns fully-implemented for solo', () => {
  assert.equal(getModeCapabilityStatus('solo'), 'fully-implemented');
});

test('getModeCapabilityStatus returns non-fully-implemented for team', () => {
  assert.notEqual(getModeCapabilityStatus('team'), 'fully-implemented');
});

test('getModeCapabilityStatus returns non-fully-implemented for enterprise', () => {
  assert.notEqual(getModeCapabilityStatus('enterprise'), 'fully-implemented');
});

test('getUnsupportedCapabilities returns only non-implemented entries', () => {
  for (const mode of ['solo', 'team', 'enterprise']) {
    const unsupported = getUnsupportedCapabilities(mode);
    for (const cap of unsupported) {
      assert.notEqual(cap.status, 'implemented', `${cap.id} must not be implemented to appear here`);
    }
  }
});

test('getUnsupportedCapabilities is empty for solo', () => {
  assert.equal(getUnsupportedCapabilities('solo').length, 0);
});

test('getUnsupportedCapabilities is non-empty for team', () => {
  assert.ok(getUnsupportedCapabilities('team').length > 0);
});

test('injecting a not-implemented capability surfaces in getModeCapabilityStatus', () => {
  const cleanup = _injectCapabilityForTesting({
    id: 'test-synthetic-cap',
    label: 'Synthetic test capability',
    modes: { solo: 'not-implemented' },
  });
  try {
    assert.notEqual(getModeCapabilityStatus('solo'), 'fully-implemented');
    const unsupported = getUnsupportedCapabilities('solo');
    assert.ok(unsupported.some(c => c.id === 'test-synthetic-cap'));
  } finally {
    cleanup();
  }
});

test('cleanup restores solo to fully-implemented', () => {
  const cleanup = _injectCapabilityForTesting({
    id: 'test-cleanup-cap',
    label: 'Cleanup test capability',
    modes: { solo: 'not-implemented' },
  });
  cleanup();
  assert.equal(getModeCapabilityStatus('solo'), 'fully-implemented');
  assert.equal(getUnsupportedCapabilities('solo').length, 0);
});

test('buildStatus exposes capabilityStatus and unsupportedCapabilities for team mode', async () => {
  const env = { ...process.env, CONSTRUCT_DEPLOYMENT_MODE: 'team' };
  const status = await buildStatus({ rootDir: ROOT_DIR, env });
  assert.ok(status.deployment, 'buildStatus must have deployment key');
  assert.ok('capabilityStatus' in status.deployment, 'deployment must have capabilityStatus');
  assert.ok('unsupportedCapabilities' in status.deployment, 'deployment must have unsupportedCapabilities');
  assert.notEqual(status.deployment.capabilityStatus, 'fully-implemented');
  assert.ok(status.deployment.unsupportedCapabilities.length > 0);
});

test('single-source invariant: injected capability appears in buildStatus without touching status.mjs', async () => {
  const cleanup = _injectCapabilityForTesting({
    id: 'test-invariant-cap',
    label: 'Invariant test capability',
    modes: { solo: 'not-implemented' },
  });
  try {
    const env = { ...process.env, CONSTRUCT_DEPLOYMENT_MODE: 'solo' };
    const status = await buildStatus({ rootDir: ROOT_DIR, env });
    assert.notEqual(status.deployment.capabilityStatus, 'fully-implemented');
    assert.ok(status.deployment.unsupportedCapabilities.some(c => c.id === 'test-invariant-cap'));
  } finally {
    cleanup();
  }
});
