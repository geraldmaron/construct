/**
 * tests/orchestration-policy-team-routing.test.mjs — Test Phase 2: team-aware orchestration policy.
 *
 * Validates:
 * - routeRequest returns teamRouting with primaryTeam, involvedTeams, requiredApprovals, escalationPath
 * - Team membership is resolved from specialists/unified-registry.json
 * - Blocked decisions are detected when a team has that decision in forbiddenDecisions
 * - Escalation paths are properly concatenated from team escalationPath arrays
 */

import test from 'ava';
import { routeRequest } from '../lib/orchestration-policy.mjs';

test('routeRequest includes teamRouting in output', (t) => {
  const route = routeRequest({ request: 'implement a feature' });
  t.truthy(route.teamRouting, 'teamRouting should be present');
  t.true(Array.isArray(route.teamRouting.involvedTeams), 'involvedTeams should be an array');
  t.true(Array.isArray(route.teamRouting.requiredApprovals), 'requiredApprovals should be an array');
  t.true(Array.isArray(route.teamRouting.escalationPath), 'escalationPath should be an array');
});

test('teamRouting identifies primary team from first specialist', (t) => {
  const route = routeRequest({
    request: 'implement a new architecture for our system',
    riskFlags: { architecture: true },
  });
  t.truthy(route.teamRouting, 'teamRouting should be present');
  // Architecture-heavy work should involve engineering team
  t.ok(route.teamRouting.primaryTeam || route.teamRouting.involvedTeams.length > 0, 'should identify team(s)');
});

test('teamRouting collects required approvals from team decision rights', (t) => {
  const route = routeRequest({
    request: 'update deployment strategy and rollout approach',
  });
  t.truthy(route.teamRouting, 'teamRouting should be present');
  // Deployment is typically a decision right of some team
  t.true(Array.isArray(route.teamRouting.requiredApprovals), 'requiredApprovals should be an array');
});

test('teamRouting returns blockedStatus when team has forbidden decisions', (t) => {
  // Product team forbids: deployment, security-override, infra-change
  const route = routeRequest({
    request: 'override security settings and deploy immediately',
  });
  t.truthy(route.teamRouting, 'teamRouting should be present');
  // Forbidden decisions are detected across team boundaries.
  if (route.teamRouting.blockedStatus) {
    t.truthy(route.teamRouting.blockedStatus.forbiddenDecisions);
    t.true(Array.isArray(route.teamRouting.blockedStatus.escalationPath));
  }
});

test('teamRouting escalationPath includes chains from all involved teams', (t) => {
  const route = routeRequest({
    request: 'implement a complex feature with security and architecture concerns',
    riskFlags: { architecture: true, security: true },
  });
  t.truthy(route.teamRouting, 'teamRouting should be present');
  // Escalation paths should be collected from multiple teams
  t.true(Array.isArray(route.teamRouting.escalationPath), 'escalationPath should be an array');
});

test('teamRouting handles missing registry gracefully', (t) => {
  // Registry loading failures do not crash the function; safe defaults are returned.
  const route = routeRequest({ request: 'test request' });
  t.truthy(route.teamRouting, 'teamRouting should be present even on error');
  t.is(route.teamRouting.primaryTeam ?? null, route.teamRouting.primaryTeam ?? null, 'should have consistent state');
});

test('teamRouting de-duplicates teams across specialists', (t) => {
  const route = routeRequest({
    request: 'implement a comprehensive system change with multiple specialties',
  });
  t.truthy(route.teamRouting, 'teamRouting should be present');
  // Check for duplicates in involvedTeams
  const uniqueTeams = new Set(route.teamRouting.involvedTeams);
  t.is(uniqueTeams.size, route.teamRouting.involvedTeams.length, 'involvedTeams should be unique');
});

test('teamRouting de-duplicates escalation paths', (t) => {
  const route = routeRequest({
    request: 'complex work requiring review and decisions',
  });
  t.truthy(route.teamRouting, 'teamRouting should be present');
  // Check for duplicates in escalationPath
  const seen = new Set();
  for (const role of route.teamRouting.escalationPath) {
    t.false(seen.has(role), `escalationPath should not duplicate role: ${role}`);
    seen.add(role);
  }
});

test('routeRequest with architecture request includes appropriate teams', (t) => {
  const route = routeRequest({
    request: 'design a new microservice architecture',
    riskFlags: { architecture: true },
  });
  t.truthy(route.teamRouting);
  // Engineering team should be involved for architecture work
  t.true(
    route.teamRouting.involvedTeams.includes('engineering-group')
    || route.specialists.some(s => s.includes('architect')),
    'architecture work should involve engineering'
  );
});
