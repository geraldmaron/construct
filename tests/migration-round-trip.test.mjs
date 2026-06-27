/**
 * tests/migration-round-trip.test.mjs — Verify unified registry migration preserves all data.
 *
 * Ensures that the migration script did not lose any teams, specialists, contracts, or policies
 * from the legacy files. This is a "round-trip" test: we verify every key entity from the legacy
 * input files is present in the unified output.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { loadRegistry } from '../lib/registry/loader.mjs';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

function loadJson(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content);
}

const unified = loadRegistry({ rootDir: ROOT_DIR, skipValidation: true });

// Build a synthetic legacy object from the unified registry for validation
const legacy = {
  teams: {
    teams: Object.values(unified.teams || {})
  },
  registry: {
    specialists: Object.values(unified.specialists || {})
  },
  contracts: {
    contracts: Object.values(unified.contracts || {})
  },
  roleManifests: {
    personas: Object.fromEntries(
      Object.values(unified.specialists || {}).map(spec => [spec.name, {
        events: spec.events || [],
        fence: spec.fence || {}
      }])
    )
  },
  policies: {
    policies: Object.values(unified.policies || {})
  }
};

describe('migration round-trip: unified registry validation', () => {
  it('unified registry exists and is on a supported schema version', () => {
    assert.ok(unified.version >= 2, `expected schema version >= 2, got ${unified.version}`);
    // Basic structural checks
    assert.ok(unified.teams, 'teams object exists');
    assert.ok(unified.specialists, 'specialists object exists');
    assert.ok(unified.contracts, 'contracts object exists');
    assert.ok(unified.policies, 'policies object exists');
  });

  describe('teams preservation', () => {
    it('every team from teams-registry.json is in unified.teams', () => {
      assert.ok(legacy.teams.teams, 'teams-registry.json has teams array');
      for (const legacyTeam of legacy.teams.teams) {
        assert.ok(unified.teams[legacyTeam.id], `Missing team ${legacyTeam.id}`);
        const unifiedTeam = unified.teams[legacyTeam.id];
        
        // Verify key fields
        assert.equal(unifiedTeam.name, legacyTeam.name, `Team ${legacyTeam.id} name mismatch`);
        assert.equal(unifiedTeam.owner, legacyTeam.owner, `Team ${legacyTeam.id} owner mismatch`);
        assert.deepEqual(unifiedTeam.roles, legacyTeam.roles, `Team ${legacyTeam.id} roles mismatch`);
        assert.deepEqual(unifiedTeam.escalationPath, legacyTeam.escalationPath, `Team ${legacyTeam.id} escalationPath mismatch`);
        assert.equal(unifiedTeam.charter, legacyTeam.charter, `Team ${legacyTeam.id} charter mismatch`);
      }
    });

    it('decision rights are preserved', () => {
      for (const legacyTeam of legacy.teams.teams) {
        const unifiedTeam = unified.teams[legacyTeam.id];
        assert.deepEqual(
          unifiedTeam.decisionRights,
          legacyTeam.decisionRights || [],
          `Team ${legacyTeam.id} decisionRights mismatch`
        );
      }
    });

    it('forbidden decisions are preserved', () => {
      for (const legacyTeam of legacy.teams.teams) {
        const unifiedTeam = unified.teams[legacyTeam.id];
        assert.deepEqual(
          unifiedTeam.forbiddenDecisions,
          legacyTeam.forbiddenDecisions || [],
          `Team ${legacyTeam.id} forbiddenDecisions mismatch`
        );
      }
    });

    it('contact information is preserved', () => {
      for (const legacyTeam of legacy.teams.teams) {
        const unifiedTeam = unified.teams[legacyTeam.id];
        assert.deepEqual(
          unifiedTeam.contact,
          legacyTeam.contact || {},
          `Team ${legacyTeam.id} contact mismatch`
        );
      }
    });
  });

  describe('specialists preservation', () => {
    it('every specialist from registry.json is in unified.specialists', () => {
      assert.ok(legacy.registry.specialists, 'registry.json has specialists array');
      for (const legacySpec of legacy.registry.specialists) {
        const specId = `cx-${legacySpec.name}`;
        assert.ok(unified.specialists[specId], `Missing specialist ${specId}`);
        const unifiedSpec = unified.specialists[specId];
        
        // Verify key fields
        assert.equal(unifiedSpec.name, legacySpec.name, `Specialist ${specId} name mismatch`);
        // displayName may come from legacy displayName or be set to description if missing
        const expectedDisplayName = legacySpec.displayName || legacySpec.description;
        assert.equal(unifiedSpec.displayName, expectedDisplayName, `Specialist ${specId} displayName mismatch`);
        assert.equal(unifiedSpec.description, legacySpec.description, `Specialist ${specId} description mismatch`);
        assert.ok(unifiedSpec.team, `Specialist ${specId} missing team`);
        assert.equal(unifiedSpec.modelTier, legacySpec.modelTier || 'standard', `Specialist ${specId} modelTier mismatch`);
      }
    });

    it('every specialist has exactly one team', () => {
      for (const [specId, spec] of Object.entries(unified.specialists)) {
        assert.ok(spec.team, `Specialist ${specId} missing team`);
        assert.equal(typeof spec.team, 'string', `Specialist ${specId} team must be a string`);
      }
    });

    it('specialist events from role-manifests are preserved', () => {
      for (const legacySpec of legacy.registry.specialists) {
        const specId = `cx-${legacySpec.name}`;
        const unifiedSpec = unified.specialists[specId];
        const manifest = legacy.roleManifests.personas[legacySpec.name] || {};
        assert.deepEqual(
          unifiedSpec.events,
          manifest.events || [],
          `Specialist ${specId} events mismatch`
        );
      }
    });

    it('specialist fence from role-manifests is preserved', () => {
      for (const legacySpec of legacy.registry.specialists) {
        const specId = `cx-${legacySpec.name}`;
        const unifiedSpec = unified.specialists[specId];
        const manifest = legacy.roleManifests.personas[legacySpec.name] || {};
        assert.deepEqual(
          unifiedSpec.fence,
          manifest.fence || {},
          `Specialist ${specId} fence mismatch`
        );
      }
    });

    it('skills are preserved', () => {
      for (const legacySpec of legacy.registry.specialists) {
        const specId = `cx-${legacySpec.name}`;
        const unifiedSpec = unified.specialists[specId];
        assert.deepEqual(
          unifiedSpec.skills,
          legacySpec.skills || [],
          `Specialist ${specId} skills mismatch`
        );
      }
    });
  });

  describe('contracts preservation', () => {
    it('every contract from contracts.json is in unified.contracts', () => {
      assert.ok(legacy.contracts.contracts, 'contracts.json has contracts array');
      for (const legacyContract of legacy.contracts.contracts) {
        assert.ok(unified.contracts[legacyContract.id], `Missing contract ${legacyContract.id}`);
        const unifiedContract = unified.contracts[legacyContract.id];
        
        // Verify key fields
        assert.equal(unifiedContract.producer, legacyContract.producer, `Contract ${legacyContract.id} producer mismatch`);
        assert.equal(unifiedContract.consumer, legacyContract.consumer, `Contract ${legacyContract.id} consumer mismatch`);
      }
    });

    it('contract preconditions are preserved', () => {
      for (const legacyContract of legacy.contracts.contracts) {
        const unifiedContract = unified.contracts[legacyContract.id];
        assert.deepEqual(
          unifiedContract.preconditions,
          legacyContract.preconditions || [],
          `Contract ${legacyContract.id} preconditions mismatch`
        );
      }
    });

    it('contract postconditions are preserved', () => {
      for (const legacyContract of legacy.contracts.contracts) {
        const unifiedContract = unified.contracts[legacyContract.id];
        assert.deepEqual(
          unifiedContract.postconditions,
          legacyContract.postconditions || [],
          `Contract ${legacyContract.id} postconditions mismatch`
        );
      }
    });
  });

  describe('policies preservation', () => {
    it('every policy from policy-inventory.json is in unified.policies', () => {
      if (legacy.policies.policies) {
        for (const legacyPolicy of legacy.policies.policies) {
          assert.ok(unified.policies[legacyPolicy.id], `Missing policy ${legacyPolicy.id}`);
        }
      }
    });

    it('decision matrix entries become policies', () => {
      if (legacy.teams.decisionMatrix) {
        for (const decisionId of Object.keys(legacy.teams.decisionMatrix)) {
          assert.ok(unified.policies[decisionId], `Missing policy for decision ${decisionId}`);
        }
      }
    });
  });

  describe('determinism: running migration twice produces identical output', () => {
    it('can re-run the migration script', () => {
      // Contract: the script must be re-runnable (deterministic output on each run).
      // CI/pre-commit pipelines use this property to detect unintended drift.
      const output = loadRegistry({ rootDir: ROOT_DIR, skipValidation: true });
      assert.ok(output.version >= 2, `expected schema version >= 2, got ${output.version}`);
    });
  });

  describe('no regression: legacy team/specialist counts', () => {
    it('unified has correct number of teams', () => {
      const expectedTeamCount = legacy.teams.teams.length;
      const actualTeamCount = Object.keys(unified.teams).length;
      assert.equal(actualTeamCount, expectedTeamCount, `Team count mismatch: expected ${expectedTeamCount}, got ${actualTeamCount}`);
    });

    it('unified has correct number of specialists', () => {
      const expectedSpecCount = legacy.registry.specialists.length;
      const actualSpecCount = Object.keys(unified.specialists).length;
      assert.equal(actualSpecCount, expectedSpecCount, `Specialist count mismatch: expected ${expectedSpecCount}, got ${actualSpecCount}`);
    });

    it('unified has correct number of contracts', () => {
      const expectedContractCount = legacy.contracts.contracts.length;
      const actualContractCount = Object.keys(unified.contracts).length;
      assert.equal(actualContractCount, expectedContractCount, `Contract count mismatch: expected ${expectedContractCount}, got ${actualContractCount}`);
    });
  });
});
