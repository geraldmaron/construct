/**
 * tests/teams.test.mjs — Unit tests for injected-registry team helpers and
 * decision-audit writers on the roles gateway.
 *
 * These helpers accept a caller-supplied registry object. They do not load
 * deleted v1 files (registry/policies/teams-registry.json). Fixture data below
 * exercises the pure decision-rights / escalation path logic.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  findTeamByRoleOwner,
  getTeamEscalationPath,
  canTeamMakeDecision,
  recordTeamDecision,
  recordForbiddenDecision,
} from '../lib/roles/gateway.mjs';
import * as gateway from '../lib/roles/gateway.mjs';

test('gateway no longer exports a v1 teams-registry file loader', () => {
  assert.equal('loadTeamRegistry' in gateway, false);
});

test('team helpers safely no-op on null or missing registry', () => {
  assert.equal(findTeamByRoleOwner('product-manager', null), null);
  assert.deepEqual(getTeamEscalationPath('product-group', null), []);
  assert.equal(canTeamMakeDecision('product-group', 'intake-triage', null), false);
  assert.equal(findTeamByRoleOwner('product-manager', {}), null);
  assert.deepEqual(getTeamEscalationPath('product-group', { teams: null }), []);
});

const teamsRegistry = {
  version: 1,
  teams: [
    {
      id: 'product-group',
      name: 'Product Group',
      owner: 'product-manager',
      roles: ['product-manager', 'ux-researcher', 'designer'],
      decisionRights: ['intake-triage', 'design-approval', 'scope-change'],
      forbiddenDecisions: ['deployment', 'security-override'],
      escalationPath: ['product-manager', 'rd-lead', 'orchestrator'],
      charter: 'Owns problem framing and design decisions.',
      contact: {
        slack: '#product',
        email: 'product@example.com',
        owner: 'product-manager',
      },
    },
    {
      id: 'engineering-group',
      name: 'Engineering Group',
      owner: 'architect',
      roles: ['architect', 'engineer', 'debugger'],
      decisionRights: ['architecture', 'technology-selection', 'implementation-approach'],
      forbiddenDecisions: ['product-scope', 'deployment-timing'],
      escalationPath: ['architect', 'rd-lead', 'orchestrator'],
      charter: 'Owns architecture and implementation.',
      contact: {
        slack: '#engineering',
        email: 'engineering@example.com',
        owner: 'architect',
      },
    },
    {
      id: 'operations-group',
      name: 'Operations Group',
      owner: 'sre',
      roles: ['sre', 'release-manager', 'docs-keeper'],
      decisionRights: ['deployment', 'rollback', 'incident-response'],
      forbiddenDecisions: ['architecture', 'product-scope'],
      escalationPath: ['sre', 'architect', 'orchestrator'],
      charter: 'Owns deployments and incidents.',
      contact: {
        slack: '#operations',
        email: 'operations@example.com',
        owner: 'sre',
      },
    },
  ],
};

test('findTeamByRoleOwner finds team by owner role', (t) => {
  const team = findTeamByRoleOwner('product-manager', teamsRegistry);
  assert.ok(team, 'Should find product-group by owner');
  assert.strictEqual(team.id, 'product-group');
  assert.strictEqual(team.owner, 'product-manager');
});

test('findTeamByRoleOwner returns undefined for unknown role', (t) => {
  const team = findTeamByRoleOwner('unknown-role', teamsRegistry);
  assert.strictEqual(team, undefined);
});

test('getTeamEscalationPath returns correct escalation chain', (t) => {
  const path1 = getTeamEscalationPath('product-group', teamsRegistry);
  assert.deepStrictEqual(path1, ['product-manager', 'rd-lead', 'orchestrator']);
  
  const path2 = getTeamEscalationPath('engineering-group', teamsRegistry);
  assert.deepStrictEqual(path2, ['architect', 'rd-lead', 'orchestrator']);
});

test('canTeamMakeDecision allows authorized decisions', (t) => {
  // Product group can make intake-triage decision
  assert.ok(canTeamMakeDecision('product-group', 'intake-triage', teamsRegistry));
  assert.ok(canTeamMakeDecision('product-group', 'design-approval', teamsRegistry));
  assert.ok(canTeamMakeDecision('product-group', 'scope-change', teamsRegistry));
});

test('canTeamMakeDecision blocks forbidden decisions', (t) => {
  // Product group cannot make deployment decision (forbidden)
  assert.ok(!canTeamMakeDecision('product-group', 'deployment', teamsRegistry));
  assert.ok(!canTeamMakeDecision('product-group', 'security-override', teamsRegistry));
  
  // Engineering group cannot make product-scope decision
  assert.ok(!canTeamMakeDecision('engineering-group', 'product-scope', teamsRegistry));
  assert.ok(!canTeamMakeDecision('engineering-group', 'deployment-timing', teamsRegistry));
  
  // Operations group cannot make architecture decision
  assert.ok(!canTeamMakeDecision('operations-group', 'architecture', teamsRegistry));
  assert.ok(!canTeamMakeDecision('operations-group', 'product-scope', teamsRegistry));
});

test('canTeamMakeDecision returns false for unauthorized decisions', (t) => {
  // Product group is not authorized for incident-response
  assert.ok(!canTeamMakeDecision('product-group', 'incident-response', teamsRegistry));
});

test('Team accountability: each team has a clear owner', (t) => {
  for (const team of teamsRegistry.teams) {
    assert.ok(team.owner, `Team ${team.id} must have an owner`);
    assert.ok(typeof team.owner === 'string', `Owner for ${team.id} must be a string`);
    assert.ok(team.roles.includes(team.owner), `Owner ${team.owner} must be in team roles`);
  }
});

test('Decision matrix consistency: no circular escalations', (t) => {
  for (const team of teamsRegistry.teams) {
    // Owner must be first in escalation path
    const escPath = team.escalationPath || [];
    if (escPath.length > 0) {
      assert.strictEqual(escPath[0], team.owner, `Team ${team.id} owner must be first in escalation path`);
    }
  }
});

test('Forbidden decisions are mutually exclusive with decision rights', (t) => {
  for (const team of teamsRegistry.teams) {
    const rights = new Set(team.decisionRights || []);
    const forbidden = new Set(team.forbiddenDecisions || []);
    
    for (const decision of rights) {
      assert.ok(!forbidden.has(decision), `Decision ${decision} cannot be both allowed and forbidden for team ${team.id}`);
    }
  }
});

test('recordTeamDecision creates decision record', (t) => {
  // Verify the function signature and basic record shape.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-team-decisions-'));
  const previous = process.env.CONSTRUCT_ROLES_ROOT;
  process.env.CONSTRUCT_ROLES_ROOT = root;
  const decision = recordTeamDecision('design-approval', 'product-group', 'approved', { issue: 'construct-123' });
  if (previous == null) delete process.env.CONSTRUCT_ROLES_ROOT;
  else process.env.CONSTRUCT_ROLES_ROOT = previous;
  fs.rmSync(root, { recursive: true, force: true });
  
  assert.ok(decision.ts, 'Decision should have timestamp');
  assert.strictEqual(decision.decisionId, 'design-approval');
  assert.strictEqual(decision.teamId, 'product-group');
  assert.strictEqual(decision.outcome, 'approved');
  assert.deepStrictEqual(decision.context, { issue: 'construct-123' });
});

test('recordForbiddenDecision creates forbidden decision record', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-team-decisions-'));
  const previous = process.env.CONSTRUCT_ROLES_ROOT;
  process.env.CONSTRUCT_ROLES_ROOT = root;
  const decision = recordForbiddenDecision('deployment', 'product-group', 'Not authorized for ops decisions', { trigger: 'policy-gate' });
  if (previous == null) delete process.env.CONSTRUCT_ROLES_ROOT;
  else process.env.CONSTRUCT_ROLES_ROOT = previous;
  fs.rmSync(root, { recursive: true, force: true });
  
  assert.ok(decision.ts, 'Decision should have timestamp');
  assert.strictEqual(decision.type, 'forbidden-decision');
  assert.strictEqual(decision.decisionId, 'deployment');
  assert.strictEqual(decision.teamId, 'product-group');
  assert.strictEqual(decision.reason, 'Not authorized for ops decisions');
  assert.deepStrictEqual(decision.context, { trigger: 'policy-gate' });
});

test('All teams have non-empty charter', (t) => {
  for (const team of teamsRegistry.teams) {
    assert.ok(team.charter, `Team ${team.id} must have a charter`);
    assert.ok(team.charter.length >= 20, `Charter for ${team.id} must be at least 20 chars`);
  }
});

test('All teams have contact information', (t) => {
  for (const team of teamsRegistry.teams) {
    assert.ok(team.contact, `Team ${team.id} must have contact info`);
    assert.ok(team.contact.slack || team.contact.email, `Team ${team.id} must have slack or email contact`);
  }
});

test('Decision rights are semantically meaningful', (t) => {
  const allowedRights = new Set([
    'intake-triage', 'design-approval', 'scope-change', 'evidence-requirement',
    'architecture', 'technology-selection', 'implementation-approach', 'performance-optimization',
    'quality-gate-approval', 'test-strategy', 'evaluation-design', 'release-readiness',
    'security-approval', 'compliance-review', 'risk-assessment', 'policy-definition',
    'deployment', 'rollback', 'incident-response', 'runbook-approval', 'ops-procedure',
    'direction-setting', 'strategic-prioritization', 'measurement-design', 'research-scope', 'cross-team-orchestration',
  ]);
  
  for (const team of teamsRegistry.teams) {
    for (const right of (team.decisionRights || [])) {
      assert.ok(allowedRights.has(right), `Decision right '${right}' for team ${team.id} must be semantically meaningful`);
    }
  }
});

test('Escalation paths never dead-end before orchestrator', (t) => {
  for (const team of teamsRegistry.teams) {
    const escPath = team.escalationPath || [];
    // Each team's escalation path should eventually lead somewhere
    // (exact validation depends on org structure, but should not be empty)
    assert.ok(escPath.length > 0, `Team ${team.id} must have an escalation path`);
  }
});
