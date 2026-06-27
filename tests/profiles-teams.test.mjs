/**
 * tests/profiles-teams.test.mjs — Profile team resolution helpers.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { loadScope } from '../lib/scopes/loader.mjs';
import {
  classifyObjectiveForScope,
  resolveIntentTeamForScope,
} from '../lib/scopes/teams.mjs';

test('operations scope maps investigation intent to reliability-team', () => {
  const scope = loadScope('operations');
  assert.equal(resolveIntentTeamForScope('investigation', scope), 'operations-team');
  assert.equal(resolveIntentTeamForScope('implementation', scope), 'engineering-team');
});

test('operations scope classifies incident objectives to operations-team', () => {
  const scope = loadScope('operations');
  const match = classifyObjectiveForScope('respond to production outage and rollback deploy', scope);
  assert.equal(match.recommendedTeam, 'operations-team');
  assert.equal(match.scopeTeamSource, 'operations');
});
