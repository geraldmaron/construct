/**
 * tests/registry-validation.test.mjs — Registry validator tests.
 *
 * Tests all 13 invariants with positive and negative cases.
 * Plus a smoke test against the real unified registry.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { validate } from '../lib/registry/validator.mjs';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

function validRegistry() {
  return {
    version: 2,
    teams: {
      'team-a': {
        id: 'team-a',
        name: 'Team A',
        owner: 'role-a',
        roles: ['role-a', 'role-b'],
        decisionRights: ['decision-1'],
        forbiddenDecisions: [],
        escalationPath: ['role-a', 'orchestrator'],
        charter: 'Team A charter.',
        contact: {},
        evidence: [],
      },
    },
    specialists: {
      'cx-spec-a': {
        name: 'spec-a',
        team: 'team-a',
        role: 'role-a',
        modelTier: 'standard',
      },
    },
    contracts: {
      'contract-1': {
        id: 'contract-1',
        producer: 'user',
        consumer: 'cx-spec-a',
      },
    },
    policies: {
      'decision-1': {
        id: 'decision-1',
        owner: 'team-a',
      },
    },
  };
}

describe('registry validator', () => {
  describe('1. Schema compliance', () => {
    it('passes with valid version and all required objects', () => {
      const reg = validRegistry();
      const result = validate(reg);
      assert.equal(result.ok, true);
    });

    it('rejects invalid version', () => {
      const reg = validRegistry();
      reg.version = 1;
      const result = validate(reg);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.id === 'invalid-version'));
    });

    it('rejects missing teams object', () => {
      const reg = validRegistry();
      delete reg.teams;
      const result = validate(reg);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.id === 'missing-teams'));
    });

    it('rejects null input', () => {
      const result = validate(null);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.id === 'invalid-input'));
    });
  });

  describe('2. Team has owner specialist', () => {
    it('passes when team owner specialist exists', () => {
      const reg = validRegistry();
      const result = validate(reg);
      assert.equal(result.ok, true);
    });

    it('fails when team owner specialist is missing', () => {
      const reg = validRegistry();
      reg.specialists['cx-spec-a'].role = 'member';
      const result = validate(reg);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.id === 'team-no-owner-specialist'));
    });

    it('fails when team missing owner field', () => {
      const reg = validRegistry();
      delete reg.teams['team-a'].owner;
      const result = validate(reg);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.id === 'team-missing-owner'));
    });
  });

  describe('3. Specialist team exists', () => {
    it('passes when all specialists reference valid teams', () => {
      const reg = validRegistry();
      const result = validate(reg);
      assert.equal(result.ok, true);
    });

    it('fails when specialist references unknown team', () => {
      const reg = validRegistry();
      reg.specialists['cx-spec-a'].team = 'unknown-team';
      const result = validate(reg);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.id === 'specialist-unknown-team'));
    });

    it('fails when specialist missing team', () => {
      const reg = validRegistry();
      delete reg.specialists['cx-spec-a'].team;
      const result = validate(reg);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.id === 'specialist-missing-team'));
    });
  });

  describe('4. Every team has at least one specialist', () => {
    it('passes when team has specialist', () => {
      const reg = validRegistry();
      const result = validate(reg);
      assert.equal(result.ok, true);
    });

    it('fails when team has no specialists', () => {
      const reg = validRegistry();
      delete reg.specialists['cx-spec-a'];
      const result = validate(reg);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.id === 'team-no-specialists'));
    });
  });

  describe('5. No name collisions', () => {
    it('passes with unique specialist names', () => {
      const reg = validRegistry();
      const result = validate(reg);
      assert.equal(result.ok, true);
    });

    it('fails with duplicate specialist names', () => {
      const reg = validRegistry();
      reg.specialists['cx-spec-b'] = { ...reg.specialists['cx-spec-a'], team: 'team-a' };
      const result = validate(reg);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.id === 'specialist-name-collision'));
    });
  });

  describe('6. Decision right has policy', () => {
    it('passes when decision right has corresponding policy', () => {
      const reg = validRegistry();
      const result = validate(reg);
      assert.equal(result.ok, true);
    });

    it('warns when decision right has no policy', () => {
      const reg = validRegistry();
      reg.teams['team-a'].decisionRights = ['decision-1', 'nonexistent-decision'];
      const result = validate(reg);
      assert.ok(result.warnings.some((w) => w.id === 'decision-no-policy'));
    });
  });

  describe('7. Forbidden decisions are valid', () => {
    it('passes when forbidden decisions are recognized', () => {
      const reg = validRegistry();
      reg.teams['team-a'].forbiddenDecisions = ['decision-1'];
      const result = validate(reg);
      assert.equal(result.ok, true);
    });

    it('warns when forbidden decision is not recognized', () => {
      const reg = validRegistry();
      reg.teams['team-a'].forbiddenDecisions = ['nonexistent-decision'];
      const result = validate(reg);
      assert.ok(result.warnings.some((w) => w.id === 'forbidden-decision-invalid'));
    });
  });

  describe('8. Escalation path valid', () => {
    it('passes with valid escalation path', () => {
      const reg = validRegistry();
      const result = validate(reg);
      assert.equal(result.ok, true);
    });

    it('fails with invalid role in escalation path', () => {
      const reg = validRegistry();
      reg.teams['team-a'].escalationPath = ['nonexistent-role', 'orchestrator'];
      const result = validate(reg);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.id === 'escalation-path-invalid-role'));
    });

    it('allows orchestrator in escalation path', () => {
      const reg = validRegistry();
      reg.teams['team-a'].escalationPath = ['role-a', 'orchestrator'];
      const result = validate(reg);
      assert.equal(result.ok, true);
    });
  });

  describe('9. No circular escalation', () => {
    it('passes with linear escalation path', () => {
      const reg = validRegistry();
      const result = validate(reg);
      assert.equal(result.ok, true);
    });

    it('fails with circular escalation path', () => {
      const reg = validRegistry();
      reg.teams['team-a'].escalationPath = ['role-a', 'role-a'];
      const result = validate(reg);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.id === 'circular-escalation'));
    });
  });

  describe('10. Contract parties exist', () => {
    it('passes when contract parties are valid', () => {
      const reg = validRegistry();
      const result = validate(reg);
      assert.equal(result.ok, true);
    });

    it('fails with unknown producer', () => {
      const reg = validRegistry();
      reg.contracts['contract-1'].producer = 'cx-unknown';
      const result = validate(reg);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.id === 'contract-unknown-producer'));
    });

    it('fails with unknown consumer', () => {
      const reg = validRegistry();
      reg.contracts['contract-1'].consumer = 'cx-unknown';
      const result = validate(reg);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.id === 'contract-unknown-consumer'));
    });

    it('allows user and construct as parties', () => {
      const reg = validRegistry();
      reg.contracts['contract-2'] = { id: 'contract-2', producer: 'construct', consumer: 'user' };
      const result = validate(reg);
      assert.equal(result.ok, true);
    });
  });

  describe('11. Contract team boundaries valid', () => {
    it('passes when team boundaries reference valid teams', () => {
      const reg = validRegistry();
      reg.contracts['contract-1'].teamBoundary = {
        crosses: true,
        producerTeam: 'team-a',
        consumerTeam: 'team-a',
      };
      const result = validate(reg);
      assert.equal(result.ok, true);
    });

    it('fails when team boundary references unknown team', () => {
      const reg = validRegistry();
      reg.contracts['contract-1'].teamBoundary = {
        crosses: true,
        producerTeam: 'unknown-team',
        consumerTeam: 'team-a',
      };
      const result = validate(reg);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.id === 'contract-unknown-team'));
    });
  });

  describe('12. Policy team owner exists', () => {
    it('passes when policy owner is valid team', () => {
      const reg = validRegistry();
      const result = validate(reg);
      assert.equal(result.ok, true);
    });

    it('fails when policy owner is unknown team', () => {
      const reg = validRegistry();
      reg.policies['decision-1'].owner = 'unknown-team';
      const result = validate(reg);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.id === 'policy-unknown-owner'));
    });

    it('allows orchestrator as owner', () => {
      const reg = validRegistry();
      reg.policies['decision-1'].owner = 'orchestrator';
      const result = validate(reg);
      assert.equal(result.ok, true);
    });
  });

  describe('13. Policy approver teams exist', () => {
    it('passes when approvers are valid teams', () => {
      const reg = validRegistry();
      reg.policies['decision-1'].requiresApprovalFrom = ['team-a'];
      const result = validate(reg);
      assert.equal(result.ok, true);
    });

    it('fails when approver is unknown team', () => {
      const reg = validRegistry();
      reg.policies['decision-1'].requiresApprovalFrom = ['unknown-team'];
      const result = validate(reg);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.id === 'policy-unknown-approver'));
    });
  });

  describe('smoke test: real unified registry', () => {
    it('validates real unified-registry.json successfully', () => {
      const regPath = path.join(ROOT_DIR, 'specialists/unified-registry.json');
      const regText = fs.readFileSync(regPath, 'utf8');
      const reg = JSON.parse(regText);

      const result = validate(reg);
      assert.equal(result.ok, true, `Real registry has errors: ${result.errors.map((e) => `${e.id}: ${e.message}`).join('; ')}`);
      assert.ok(result.errors.length === 0, 'No errors should be present');
    });
  });
});
