/**
 * tests/worker-profile-roster.test.mjs — lazy Worker Profile catalog.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWorkerProfileCatalog, formatWorkerProfileRosterText } from '../lib/worker-profiles/roster.mjs';

test('buildWorkerProfileCatalog lists public Worker Profiles with routing hints', () => {
  const catalog = buildWorkerProfileCatalog();
  // A consolidation reduced the 29-Worker Profile roster to 12 (orchestrator + 11 workers).
  assert.ok(catalog.length >= 10);
  assert.ok(catalog.every((row) => row.id && row.whenToUse.length > 0));
  assert.equal(catalog.some((row) => row.id === 'engineer'), true);
  assert.equal(catalog.some((row) => row.id === 'orchestrator'), true, 'internal Worker Profiles are routable via orchestration_policy');
});

test('formatWorkerProfileRosterText matches the legacy roster line shape', () => {
  const text = formatWorkerProfileRosterText([
    { id: 'engineer', whenToUse: 'implementation work' },
  ]);
  assert.equal(text, '- engineer: implementation work');
});
