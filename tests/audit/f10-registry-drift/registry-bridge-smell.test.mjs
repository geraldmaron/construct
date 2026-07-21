/**
 * tests/audit/f10-registry-drift/registry-bridge-smell.test.mjs — canonical registry cache guard.
 *
 * Verifies cache clearing is idempotent against the canonical Worker Profile
 * registry and prevents duplicate consecutive flushes from returning to the
 * synchronization script.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { clearCache, loadRegistry } from '../../../lib/registry/loader.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SYNC_SCRIPT = path.join(REPO_ROOT, 'scripts', 'sync-worker-profiles.mjs');

test('[R34] clearCache is idempotent — a second consecutive flush is a no-op', () => {
  clearCache();
  const afterOne = loadRegistry({ rootDir: REPO_ROOT });

  clearCache();
  clearCache();
  const afterTwo = loadRegistry({ rootDir: REPO_ROOT });

  assert.deepEqual(
    Object.keys(afterTwo.workerProfiles).sort(),
    Object.keys(afterOne.workerProfiles).sort(),
    'two clearCache() calls produce the same loader state as one — the duplicate flush is redundant',
  );
});

test('[R34] sync-worker-profiles.mjs no longer calls clearCache twice in a row', () => {
  const source = fs.readFileSync(SYNC_SCRIPT, 'utf8');
  const consecutive = /clearCache\(\);\s*\n\s*clearCache\(\);/m.test(source);
  assert.equal(
    consecutive,
    false,
    'scripts/sync-worker-profiles.mjs:120-121 calls clearCache() twice consecutively — a bridge-accretion smell to remove',
  );
});
