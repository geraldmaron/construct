/**
 * tests/kernel/challenge/rankings.test.ts — the ranking slot check, held to
 * the same fixture discipline as the citation gate it extends: a passing
 * deliverable and a failing one, mirroring tests/kernel/claims.test.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankingsGroundedIn } from '../../../src/kernel/challenge/rankings.ts';

const GROUNDED = [
  '## priorities',
  '',
  '1. Fix the checkout crash — P0 [cite:sentry-error-rate-2026-08.csv]',
  '2. Add dark mode — P2 [assumed: no usage data exists yet for this request]',
  '3. Refactor the logging pipeline — P3 [cite:eng-oncall-log-volume.csv]',
].join('\n');

const UNGROUNDED = [
  '## priorities',
  '',
  '1. Fix the checkout crash — P0 [cite:sentry-error-rate-2026-08.csv]',
  '2. Add dark mode — P2',
  '3. Refactor the logging pipeline — P3',
].join('\n');

test('a priorities slot where every ranking is grounded or labeled passes', () => {
  const check = rankingsGroundedIn('priorities')(GROUNDED);
  assert.equal(check.passed, true);
  assert.match(check.detail, /citation or an explicit \[assumed\] label/);
});

test('a priorities slot with ungrounded rankings fails, naming which lines', () => {
  const check = rankingsGroundedIn('priorities')(UNGROUNDED);
  assert.equal(check.passed, false);
  assert.match(check.detail, /2 ranking\(s\)/);
});

test('rankings outside the named slot do not count against it', () => {
  const deliverable = [
    '## finding',
    '',
    'The onboarding flow is the top priority for next quarter.',
    '',
    '## priorities',
    '',
    '1. Fix the checkout crash — P0 [cite:sentry-error-rate-2026-08.csv]',
  ].join('\n');
  const check = rankingsGroundedIn('priorities')(deliverable);
  assert.equal(check.passed, true, 'an ungrounded ranking outside the slot is not this slot\'s failure');
});

test('a deliverable that never heads the slot falls back to reading itself whole', () => {
  const noHeading = '## finding\n\nShip the export flow next: priority 1.\n';
  assert.equal(rankingsGroundedIn('priorities')(noHeading).passed, false);

  const noHeadingGrounded =
    '## finding\n\nShip the export flow next: priority 1 [cite:support-ticket-volume.csv].\n';
  assert.equal(rankingsGroundedIn('priorities')(noHeadingGrounded).passed, true);
});

test('an [unverified] tag does not satisfy the ranking slot, unlike the general citation gate', () => {
  const unverifiedOnly = '## priorities\n\n1. Rebuild the settings page — P1 [unverified]\n';
  const check = rankingsGroundedIn('priorities')(unverifiedOnly);
  assert.equal(check.passed, false);
});

test('a slot with no ranking-shaped content at all passes trivially', () => {
  const noRankings = '## priorities\n\nNothing has been ranked yet; the backlog is still being triaged.\n';
  assert.equal(rankingsGroundedIn('priorities')(noRankings).passed, true);
});

test('the same factory reads a differently named slot', () => {
  const orderSlot = '## order\n\n1. Migrate the database — P0\n';
  assert.equal(rankingsGroundedIn('order')(orderSlot).passed, false);
  // Naming the wrong slot means the content is read as unheaded and the
  // check falls back to the whole deliverable, which still contains the
  // same ungrounded ranking.
  assert.equal(rankingsGroundedIn('priorities')(orderSlot).passed, false);
});
