/**
 * tests/registry/skill-consolidation.test.mjs — bound-orphan triage honesty for alignment census.
 *
 * B-composer role flavors are registry orphans by design (prompt-composer reachability).
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
  assert.ok(triage.composerReachableCount >= 40, 'role flavors should classify as B-composer');
  assert.equal(
    triage.boundOrphanCount,
    triage.composerReachableCount + triage.aBindCount + triage.trueOrphanCount,
    'category counts should partition bound orphans',
  );
  assert.equal(triage.trueOrphanCount, triage.byCategory['C-merge'].length + triage.byCategory['D-review'].length);
});
