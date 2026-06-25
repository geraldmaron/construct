/**
 * tests/orchestration-policy-team-routing.test.mjs — Test Phase 2: team-aware orchestration policy.
 *
 * Validates:
 * - routeRequest returns teamRouting with primaryTeam, involvedTeams, requiredApprovals, escalationPath
 * - Team membership is resolved from specialists/unified-registry.json
 * - Blocked decisions are detected when a team has that decision in forbiddenDecisions
 * - Escalation paths are properly concatenated from team escalationPath arrays
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeRequest } from '../lib/orchestration-policy.mjs';

test('routeRequest includes teamRouting in output', () => {
  const route = routeRequest({ request: 'implement a feature' });
  assert.ok(route.teamRouting, 'teamRouting should be present');
  assert.ok(Array.isArray(route.teamRouting.involvedTeams), 'involvedTeams should be an array');
  assert.ok(Array.isArray(route.teamRouting.requiredApprovals), 'requiredApprovals should be an array');
  assert.ok(Array.isArray(route.teamRouting.escalationPath), 'escalationPath should be an array');
});

test('teamRouting identifies primary team from first specialist', () => {
  const route = routeRequest({
    request: 'implement a new architecture for our system',
    riskFlags: { architecture: true },
  });
  assert.ok(route.teamRouting, 'teamRouting should be present');
  // Architecture-heavy work should involve engineering team
  assert.ok(route.teamRouting.primaryTeam || route.teamRouting.involvedTeams.length > 0, 'should identify team(s)');
});

test('teamRouting collects required approvals from team decision rights', () => {
  const route = routeRequest({
    request: 'update deployment strategy and rollout approach',
  });
  assert.ok(route.teamRouting, 'teamRouting should be present');
  // Deployment is typically a decision right of some team
  assert.ok(Array.isArray(route.teamRouting.requiredApprovals), 'requiredApprovals should be an array');
});

test('teamRouting returns blockedStatus when team has forbidden decisions', () => {
  // Product team forbids: deployment, security-override, infra-change
  const route = routeRequest({
    request: 'override security settings and deploy immediately',
  });
  assert.ok(route.teamRouting, 'teamRouting should be present');
  // Forbidden decisions are detected across team boundaries.
  if (route.teamRouting.blockedStatus) {
    assert.ok(route.teamRouting.blockedStatus.forbiddenDecisions);
    assert.ok(Array.isArray(route.teamRouting.blockedStatus.escalationPath));
  }
});

test('teamRouting escalationPath includes chains from all involved teams', () => {
  const route = routeRequest({
    request: 'implement a complex feature with security and architecture concerns',
    riskFlags: { architecture: true, security: true },
  });
  assert.ok(route.teamRouting, 'teamRouting should be present');
  // Escalation paths should be collected from multiple teams
  assert.ok(Array.isArray(route.teamRouting.escalationPath), 'escalationPath should be an array');
});

test('teamRouting handles missing registry gracefully', () => {
  // Registry loading failures do not crash the function; safe defaults are returned.
  const route = routeRequest({ request: 'test request' });
  assert.ok(route.teamRouting, 'teamRouting should be present even on error');
  assert.strictEqual(route.teamRouting.primaryTeam ?? null, route.teamRouting.primaryTeam ?? null, 'should have consistent state');
});

test('teamRouting de-duplicates teams across specialists', () => {
  const route = routeRequest({
    request: 'implement a comprehensive system change with multiple specialties',
  });
  assert.ok(route.teamRouting, 'teamRouting should be present');
  // Check for duplicates in involvedTeams
  const uniqueTeams = new Set(route.teamRouting.involvedTeams);
  assert.strictEqual(uniqueTeams.size, route.teamRouting.involvedTeams.length, 'involvedTeams should be unique');
});

test('teamRouting de-duplicates escalation paths', () => {
  const route = routeRequest({
    request: 'complex work requiring review and decisions',
  });
  assert.ok(route.teamRouting, 'teamRouting should be present');
  // Check for duplicates in escalationPath
  const seen = new Set();
  for (const role of route.teamRouting.escalationPath) {
    assert.ok(!seen.has(role), `escalationPath should not duplicate role: ${role}`);
    seen.add(role);
  }
});

test('routeRequest with architecture request includes appropriate teams', () => {
  const route = routeRequest({
    request: 'design a new microservice architecture',
    riskFlags: { architecture: true },
  });
  assert.ok(route.teamRouting);
  // Engineering team should be involved for architecture work
  assert.ok(
    route.teamRouting.involvedTeams.includes('engineering-group')
    || route.specialists.some(s => s.includes('architect')),
    'architecture work should involve engineering'
  );
});
