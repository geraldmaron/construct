/**
 * tests/functional/mode-degraded-fallback.functional.test.mjs — B4 contract.
 *
 * Proves that team/enterprise deployment modes cannot silently fall back to
 * solo behavior. Four assertions:
 *
 *   1. resolveRunStore() marks the result degraded when postgres is requested
 *      but unavailable, rather than silently handing back a filesystem store.
 *   2. getModeCapabilityStatus('team') is never 'fully-implemented'.
 *   3. getUnsupportedCapabilities('team') is non-empty and every entry has a
 *      status other than 'implemented'.
 *   4. buildStatus() with a team-mode env surfaces capabilityStatus and
 *      unsupportedCapabilities on the deployment block.
 */
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { resolveRunStore } from '../../lib/orchestration/store.mjs';
import { getModeCapabilityStatus, getUnsupportedCapabilities } from '../../lib/mode-capabilities.mjs';
import { buildStatus } from '../../lib/status.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ─── 1. Store degraded test ───────────────────────────────────────────────────

test('resolveRunStore falls back with degraded markers when postgres is unavailable', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mode-degraded-'));
  try {
    const result = resolveRunStore({
      config: { orchestration: { store: 'postgres' } },
      env: { CONSTRUCT_DEPLOYMENT_MODE: 'team' },
      cwd,
    });

    assert.equal(result.backend, 'filesystem', 'backend must fall back to filesystem when postgres is unavailable');
    assert.equal(result.degraded, true, 'degraded flag must be set');
    assert.equal(result.degradedReason, 'postgres-unavailable', 'degradedReason must be postgres-unavailable');
    assert.ok(result.warnings.length > 0, 'at least one warning must be emitted');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// ─── 2. Capability status test ────────────────────────────────────────────────

test('getModeCapabilityStatus("team") is not fully-implemented', () => {
  const status = getModeCapabilityStatus('team');
  assert.notEqual(status, 'fully-implemented', `team mode must not report fully-implemented; got: ${status}`);
});

test('getModeCapabilityStatus("enterprise") is not fully-implemented', () => {
  const status = getModeCapabilityStatus('enterprise');
  assert.notEqual(status, 'fully-implemented', `enterprise mode must not report fully-implemented; got: ${status}`);
});

test('getModeCapabilityStatus("solo") is fully-implemented', () => {
  const status = getModeCapabilityStatus('solo');
  assert.equal(status, 'fully-implemented', `solo mode must report fully-implemented; got: ${status}`);
});

// ─── 3. Unsupported capabilities test ────────────────────────────────────────

test('getUnsupportedCapabilities("team") is non-empty and all entries are non-implemented', () => {
  const caps = getUnsupportedCapabilities('team');
  assert.ok(caps.length > 0, 'team mode must have at least one unsupported capability');
  for (const cap of caps) {
    assert.notEqual(cap.status, 'implemented', `capability "${cap.capability}" must not be implemented`);
  }
});

test('getUnsupportedCapabilities("solo") is empty', () => {
  const caps = getUnsupportedCapabilities('solo');
  assert.equal(caps.length, 0, `solo mode must have no unsupported capabilities; got: ${JSON.stringify(caps)}`);
});

// ─── 4. Status output test ───────────────────────────────────────────────────

test('buildStatus() with team-mode env surfaces capabilityStatus and unsupportedCapabilities', async () => {
  const result = await buildStatus({
    rootDir: ROOT_DIR,
    env: { CONSTRUCT_DEPLOYMENT_MODE: 'team' },
    probeService: async () => ({ status: 'unavailable', message: 'probe suppressed in test' }),
  });

  assert.ok(result.deployment, 'deployment block must be present');
  assert.notEqual(
    result.deployment.capabilityStatus,
    'fully-implemented',
    `capabilityStatus for team mode must not be fully-implemented; got: ${result.deployment.capabilityStatus}`,
  );
  assert.ok(
    Array.isArray(result.deployment.unsupportedCapabilities),
    'unsupportedCapabilities must be an array',
  );
  assert.ok(
    result.deployment.unsupportedCapabilities.length > 0,
    'unsupportedCapabilities must be non-empty for team mode',
  );
});
