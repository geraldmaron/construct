/**
 * tests/test-registry-fixtures.mjs — Test fixtures extracted from unified registry.
 *
 * Provides test-friendly exports from registry
 * so test files don't need to directly reference deleted legacy files.
 *
 * Usage:
 *   import { registry, specialists, contracts, policies, teams } from './test-registry-fixtures.mjs'
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry } from '../lib/registry/loader.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let _cached = null;

function load() {
  if (_cached) return _cached;
  
  const registry = loadRegistry({ rootDir: ROOT_DIR });
  
  _cached = {
    registry,
    // Legacy shape conversions for backward compat in tests
    specialists: Object.entries(registry.specialists || {}).map(([id, spec]) => ({
      name: spec.name,
      displayName: spec.displayName,
      description: spec.description,
      ...spec
    })),
    contracts: Object.values(registry.contracts || {}),
    policies: Object.values(registry.policies || {}),
    teams: Object.entries(registry.teams || {}).map(([id, team]) => ({
      id,
      ...team
    }))
  };
  
  return _cached;
}

export function getRegistry() {
  return load().registry;
}

export function getSpecialists() {
  return load().specialists;
}

export function getContracts() {
  // Return legacy shape for backward compatibility
  return {
    contracts: Object.values(load().registry.contracts || {})
  };
}

export function getPolicies() {
  return load().policies;
}

export function getTeams() {
  return load().teams;
}

// For legacy compatibility: export objects that mimic the old file shapes
export const registry = new Proxy({}, {
  get: (target, prop) => {
    const data = load();
    if (prop === 'specialists') return data.specialists;
    if (prop === 'teams') return data.teams;
    return data.registry[prop];
  }
});

export const specialists = new Proxy({}, {
  get: () => load().specialists
});

export const contracts = new Proxy({}, {
  get: () => ({ contracts: load().contracts })
});

export const policies = new Proxy({}, {
  get: () => load().policies
});

export const teams = new Proxy({}, {
  get: () => load().teams
});

export default {
  getRegistry,
  getSpecialists,
  getContracts,
  getPolicies,
  getTeams,
  registry,
  specialists,
  contracts,
  policies,
  teams
};
