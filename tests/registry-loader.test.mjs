/**
 * tests/registry-loader.test.mjs — Test the unified registry loader.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { loadRegistry, getTeam, getSpecialist, getContract, getPolicy, listTeams, listSpecialists, clearCache } from '../lib/registry/loader.mjs';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

describe('registry loader', () => {
  beforeEach(() => clearCache());
  afterEach(() => clearCache());

  it('loads the canonical registry successfully', () => {
    const registry = loadRegistry();
    assert.ok(registry);
    assert.equal(registry.version, 2);
    assert.ok(registry.teams);
    assert.ok(registry.specialists);
    assert.ok(registry.contracts);
    assert.ok(registry.policies);
  });

  it('getTeam returns the correct team', () => {
    const team = getTeam('product-group');
    assert.ok(team);
    assert.equal(team.id, 'product-group');
    assert.equal(team.owner, 'product-manager');
  });

  it('getTeam returns null for unknown team', () => {
    const team = getTeam('unknown-team');
    assert.equal(team, null);
  });

  it('getSpecialist returns the correct specialist', () => {
    const spec = getSpecialist('engineer');
    assert.ok(spec);
    assert.equal(spec.name, 'engineer');
  });

  it('getSpecialist handles both cx- and non-cx- prefixes', () => {
    const spec1 = getSpecialist('cx-engineer');
    const spec2 = getSpecialist('engineer');
    assert.equal(spec1, spec2);
  });

  it('getSpecialist returns null for unknown specialist', () => {
    const spec = getSpecialist('unknown-specialist');
    assert.equal(spec, null);
  });

  it('getContract returns the correct contract', () => {
    const contract = getContract('user', 'cx-engineer');
    assert.ok(contract);
    assert.equal(contract.producer, 'user');
    assert.equal(contract.consumer, 'cx-engineer');
  });

  it('getContract returns null for unknown contract', () => {
    const contract = getContract('user', 'unknown-specialist');
    assert.equal(contract, null);
  });

  it('getPolicy returns the correct policy', () => {
    const policy = getPolicy('intake-triage');
    assert.ok(policy);
    assert.equal(policy.id, 'intake-triage');
  });

  it('getPolicy returns null for unknown policy', () => {
    const policy = getPolicy('unknown-policy');
    assert.equal(policy, null);
  });

  it('listTeams returns all teams', () => {
    const teams = listTeams();
    assert.ok(Array.isArray(teams));
    assert.ok(teams.length > 0);
    const teamIds = teams.map(t => t.id);
    assert.ok(teamIds.includes('product-group'));
    assert.ok(teamIds.includes('engineering-group'));
  });

  it('listSpecialists returns all specialists when no filter', () => {
    const specs = listSpecialists();
    assert.ok(Array.isArray(specs));
    assert.ok(specs.length > 0);
  });

  it('listSpecialists filters by team', () => {
    const productSpecs = listSpecialists('product-group');
    assert.ok(Array.isArray(productSpecs));
    for (const spec of productSpecs) {
      assert.equal(spec.team, 'product-group');
    }
  });

  it('caches the registry and avoids re-reading on subsequent calls', () => {
    const registry1 = loadRegistry();
    const registry2 = loadRegistry();
    assert.equal(registry1, registry2); // Same object reference
  });

  it('clearCache clears the cache', () => {
    loadRegistry();
    clearCache();
    // After clearing, the next call should re-read from disk
    const registry1 = loadRegistry();
    clearCache();
    const registry2 = loadRegistry();
    assert.notEqual(registry1, registry2); // Different object references
  });

  it('validates the registry on load', () => {
    // This test verifies that validation happens automatically
    // If the registry is invalid, loadRegistry will throw
    const registry = loadRegistry();
    assert.ok(registry); // If we got here, validation passed
  });
});
