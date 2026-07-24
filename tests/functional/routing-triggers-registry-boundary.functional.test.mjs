/**
 * tests/functional/routing-triggers-registry-boundary.functional.test.mjs —
 * registry-only extension boundary for routing triggers (construct-uizpv.4).
 *
 * Proves two things end to end, in an isolated project directory, against
 * the real modules (no mocks):
 *
 * 1. A brand-new domain trigger ("accessibility review") can be added as
 *    pure registry data — a .construct/orchestration/routing-triggers.json
 *    project overlay — and routeRequest() picks it up with zero lib/ file
 *    changes.
 * 2. The pre-existing legal-compliance trigger keeps producing the exact
 *    same route in that same project, proving the overlay is additive and
 *    does not disturb the canonical registry/routing-triggers.json record.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { routeRequest } from '../../lib/orchestration/flow-selection.mjs';
import { clearRoutingTriggersCache } from '../../lib/orchestration/routing-triggers.mjs';
import { EXECUTION_TRACKS } from '../../lib/orchestration/policy-constants.mjs';

test('a new domain trigger routes correctly from registry data alone, with zero lib/ edits', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cx-routing-triggers-boundary-'));
  const previousCwd = process.cwd();
  try {
    mkdirSync(path.join(root, '.construct', 'orchestration'), { recursive: true });
    writeFileSync(
      path.join(root, '.construct', 'orchestration', 'routing-triggers.json'),
      JSON.stringify({
        triggers: [
          {
            id: 'accessibility-review',
            match: { keywords: ['accessibility review', 'a11y audit'] },
            chain: ['designer'],
            position: 'prepend',
          },
        ],
      }),
    );
    process.chdir(root);
    clearRoutingTriggersCache();

    const focused = routeRequest({ request: 'run an accessibility review of the checkout flow', fileCount: 1, moduleCount: 1 });
    assert.equal(focused.track, EXECUTION_TRACKS.focused, 'new trigger must land on the focused track like other domain triggers');
    assert.deepEqual(
      focused.assignments.map((a) => a.workerProfileId),
      ['designer'],
      'accessibility-review trigger (pure registry data) must dispatch designer',
    );

    // Same project, same overlay in effect: the canonical legal-compliance
    // trigger must still fire unchanged — the overlay is additive.
    const legal = routeRequest({ request: 'review GDPR compliance of our consent flow', fileCount: 1, moduleCount: 1 });
    assert.equal(legal.track, EXECUTION_TRACKS.focused);
    assert.deepEqual(legal.assignments.map((a) => a.workerProfileId), ['security']);
  } finally {
    process.chdir(previousCwd);
    clearRoutingTriggersCache();
    rmSync(root, { recursive: true, force: true });
  }
});
