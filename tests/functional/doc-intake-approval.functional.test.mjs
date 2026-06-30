/**
 * tests/functional/doc-intake-approval.functional.test.mjs
 *
 * Characterization tests for the document-intake approval gap (self-audit construct-rr63.8.1, under
 * the migration-gate / risk R9 — silent restructuring of user docs). The intake promotion path
 * (lib/embed/inbox.mjs:276 + :440) calls maybePromoteToDocs unconditionally: when
 * suggestDocsLaneForFile returns a real lane (anything but `intake`) and the lane dir exists, the
 * document is written into that docs lane with NO approval gate and NO confidence signal. These tests
 * pin that the routing decision feeding promotion is a bare lane with no approval/confidence metadata
 * and that ADR/PRD/RFC content auto-routes to a promotable lane, so the Wave-4 change that adds an
 * `approvalRequired` gate before any user-doc-affecting write is deliberate and visible. The
 * alias-collision half of this epic (incidents/ + postmortems/) is pinned in
 * tests/registry-characterization.test.mjs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { suggestDocsLaneForFile } from '../../lib/docs-routing.mjs';
import { LANE_ORDER } from '../../lib/init/doc-lanes.mjs';

const FIXTURES = {
  adr: ['decisions/adr-auth.md', '# ADR: Auth\n## Status\nproposed\n## Decision\nWe will adopt OIDC.'],
  prd: ['product/prd-checkout.md', '# PRD: Checkout\n## Problem\n## Requirements\n## Success metrics'],
  rfc: ['rfcs/rfc-api.md', '# RFC: API\n## Motivation\n## Proposal'],
  generic: ['scratch/notes.txt', 'just some scratch notes about nothing in particular'],
};

test('ADR/PRD/RFC intake content auto-routes to a promotable lane (would promote with no approval)', () => {
  for (const key of ['adr', 'prd', 'rfc']) {
    const lane = suggestDocsLaneForFile(...FIXTURES[key]);
    assert.equal(typeof lane, 'string', `${key} routes to a lane`);
    assert.notEqual(lane, 'intake', `${key} is not held in intake — maybePromoteToDocs would write it`);
    assert.ok(LANE_ORDER.includes(lane), `${key} routes to a real docs lane (${lane})`);
  }
});

test('the routing decision carries no approval or confidence signal today', () => {
  for (const [key, args] of Object.entries(FIXTURES)) {
    const result = suggestDocsLaneForFile(...args);
    assert.ok(result === null || typeof result === 'string', `${key} routing is a bare lane or null`);
    assert.notEqual(typeof result, 'object', `${key} routing exposes no { approvalRequired, confidence } object`);
  }
});

test('even generic content auto-routes — there is no hold-for-human-decision outcome', () => {
  const lane = suggestDocsLaneForFile(...FIXTURES.generic);
  assert.equal(typeof lane, 'string', 'generic content still resolves to a lane');
  assert.ok(LANE_ORDER.includes(lane) || lane === 'intake', 'routing never returns an explicit approval-needed state');
});
