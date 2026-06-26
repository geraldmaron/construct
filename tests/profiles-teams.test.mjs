/**
 * tests/profiles-teams.test.mjs — Profile team resolution helpers.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { loadProfile } from '../lib/profiles/loader.mjs';
import {
  classifyObjectiveForProfile,
  resolveIntentTeamForProfile,
} from '../lib/profiles/teams.mjs';

test('operations profile maps investigation intent to reliability-team', () => {
  const profile = loadProfile('operations');
  assert.equal(resolveIntentTeamForProfile('investigation', profile), 'reliability-team');
  assert.equal(resolveIntentTeamForProfile('implementation', profile), 'delivery-team');
});

test('operations profile classifies incident objectives to reliability-team', () => {
  const profile = loadProfile('operations');
  const match = classifyObjectiveForProfile('respond to production outage and rollback deploy', profile);
  assert.equal(match.recommendedTeam, 'reliability-team');
  assert.equal(match.profileTeamSource, 'operations');
});
