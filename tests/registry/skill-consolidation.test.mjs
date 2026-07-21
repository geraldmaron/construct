/**
 * tests/registry/skill-consolidation.test.mjs — bound-orphan triage honesty for alignment census.
 *
 * B-composer perspective flavors are registry orphans by design because they
 * remain reachable through Worker Profile prompt composition.
 * Only C-merge and D-review rows are actionable true orphans.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { triageBoundOrphans } from '../../lib/registry/consolidation.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('triageBoundOrphans separates composer-reachable from true orphans', () => {
  const triage = triageBoundOrphans({ rootDir: root });
  assert.ok(triage.fileCount >= 140, 'expected full skill tree on disk');
  assert.ok(triage.byCategory['C-merge'].length >= 30, 'Worker Profile perspectives classify as C-merge under 2.0');
  assert.equal(
    triage.boundOrphanCount,
    triage.composerReachableCount + triage.aBindCount + triage.trueOrphanCount,
    'category counts should partition bound orphans',
  );
  assert.equal(triage.trueOrphanCount, triage.byCategory['C-merge'].length + triage.byCategory['D-review'].length);
});
