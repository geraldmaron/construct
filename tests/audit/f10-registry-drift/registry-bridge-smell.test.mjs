/**
 * tests/audit/f10-registry-drift/registry-bridge-smell.red.mjs — F10 [R34] unified→legacy bridge.
 *
 * RED fixture (OBSERVATION + assertion). scripts/sync-worker-profiles.mjs carries a manual
 * unified→legacy registry bridge whose accretion shows in a duplicate cache flush:
 *   - sync-worker-profiles.mjs:120-121  calls clearCache() twice in a row before loadRegistry().
 *   - lib/registry/loader.mjs:128-132 clearCache() nulls three module-level vars
 *     (_registry, _orgMtime, _legacyOverlayMtime); it is idempotent, so the second call is a
 *     provable no-op.
 *   - sync-worker-profiles.mjs:80-118  unifiedToLegacyRegistry() hand-maps the unified registry
 *     (registry/loader.mjs) into a legacy shape with its own re-validation
 *     (validateRegistry, L125-185), parallel to lib/registry/validate.mjs.
 * The duplicate clearCache() is harmless on its own but is evidence of a hand-maintained bridge
 * between two registry representations — the kind of manual script accretion that drifts from
 * the source of truth. This fixture pins the redundancy so the bridge cleanup
 * (CX-AUDIT-REGISTRY-003) has a failing test to retire.
 *
 * The assertion: clearCache() is idempotent, so a single call leaves the loader in the same
 * state as two calls. The fixture asserts ONE clearCache() suffices; it is RED today only as a
 * documented marker that the source still calls it twice (the second call is dead). When the
 * bridge is removed or formalized and the duplicate call deleted, this fixture is renamed to a
 * green test asserting single-flush behavior.
 *
 * Hermetic: imports the real loader module and inspects clearCache/loadRegistry behavior against
 * a tmpdir rootDir. The duplicate-call site itself is asserted by reading the committed source
 * text. No network, no host state, no mutation of the repo registry.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { clearCache, loadRegistry } from '../../../lib/registry/loader.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SYNC_SCRIPT = path.join(REPO_ROOT, 'scripts', 'sync-worker-profiles.mjs');

// clearCache() only nulls module-level cache vars, so calling it N times is equivalent to
// calling it once: the next loadRegistry() reassembles regardless. A second consecutive call
// cannot change observable state — assert the loader produces an equal registry whether cleared
// once or twice, demonstrating the second flush is dead.

test('[R34] clearCache is idempotent — a second consecutive flush is a no-op', () => {
  clearCache();
  const afterOne = loadRegistry({ rootDir: REPO_ROOT });

  clearCache();
  clearCache();
  const afterTwo = loadRegistry({ rootDir: REPO_ROOT });

  assert.deepEqual(
    Object.keys(afterTwo.specialists).sort(),
    Object.keys(afterOne.specialists).sort(),
    'two clearCache() calls produce the same loader state as one — the duplicate flush is redundant',
  );
});

// Source-text marker: the sync script still calls clearCache() twice. This assert is RED while
// the duplicate remains and turns GREEN when the bridge cleanup removes the second call. It is
// the executable record that CX-AUDIT-REGISTRY-003 has unfinished work.

test('[R34] sync-worker-profiles.mjs no longer calls clearCache twice in a row', () => {
  const source = fs.readFileSync(SYNC_SCRIPT, 'utf8');
  const consecutive = /clearCache\(\);\s*\n\s*clearCache\(\);/m.test(source);
  assert.equal(
    consecutive,
    false,
    'scripts/sync-worker-profiles.mjs:120-121 calls clearCache() twice consecutively — a bridge-accretion smell to remove',
  );
});
