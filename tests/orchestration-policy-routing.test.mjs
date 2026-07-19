/**
 * Policy routing tests for canonical Worker Profile assignments.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeRequest } from '../lib/orchestration-policy.mjs';

test('routeRequest exposes policy routing for its Worker Profile assignments', () => {
  const route = routeRequest({ request: 'implement a feature' });
  assert.ok(route.policyRouting);
  assert.ok(Array.isArray(route.policyRouting.workerProfiles));
  assert.ok(Array.isArray(route.policyRouting.policies));
  assert.ok(Array.isArray(route.policyRouting.requiredApprovals));
  assert.ok(Array.isArray(route.policyRouting.escalationPath));
  assert.equal(route.policyRouting.blockedStatus, null);
  const routedProfiles = new Set(route.policyRouting.workerProfiles);
  for (const assignment of route.assignments) assert.ok(routedProfiles.has(assignment.workerProfileId));
});

test('policy routing resolves governing policies from selected Worker Profiles', () => {
  const route = routeRequest({
    request: 'implement a complex feature with security and architecture concerns',
  });
  assert.ok(route.policyRouting.policies.length > 0);
  assert.equal(new Set(route.policyRouting.policies).size, route.policyRouting.policies.length);
});

test('policy routing de-duplicates approvals and escalation Worker Profiles', () => {
  const route = routeRequest({ request: 'complex work requiring review and decisions' });
  assert.equal(new Set(route.policyRouting.requiredApprovals).size, route.policyRouting.requiredApprovals.length);
  assert.equal(new Set(route.policyRouting.escalationPath).size, route.policyRouting.escalationPath.length);
});

test('route and routePath contain no retired organization routing fields', () => {
  const route = routeRequest({ request: 'design a new microservice architecture' });
  for (const field of ['specialists', 'policySpecialists', 'displaySpecialists', 'teamRouting']) {
    assert.equal(field in route, false);
  }
  for (const field of ['teamPath', 'specialistSequence']) {
    assert.equal(field in route.routePath, false);
  }
  assert.deepEqual(route.routePath.assignmentSequence, route.assignments.map((assignment) => assignment.id));
});
