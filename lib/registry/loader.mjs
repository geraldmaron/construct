/**
 * lib/registry/loader.mjs — Unified registry loader.
 *
 * Loads and caches the unified registry from specialists/unified-registry.json.
 * Validates against the schema on load. Supports .cx overlay merging.
 *
 * Export: loadRegistry(opts), getTeam(id), getSpecialist(id), getContract(...),
 *         getPolicy(id), listTeams(), listSpecialists(team)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validate } from './validator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');

// Cache
let _registry = null;
let _registryMtime = null;
let _overlayMtime = null;

/**
 * Load the unified registry from disk.
 * @param {object} opts - Options
 * @param {string} opts.rootDir - Root directory (defaults to package root)
 * @param {boolean} opts.skipValidation - Skip schema validation (for testing)
 * @returns {object} The registry object (specialists as object per schema)
 */
export function loadRegistry(opts = {}) {
  const skipValidation = opts.skipValidation === true;
  const rootDir = opts.rootDir ? path.resolve(opts.rootDir) : ROOT_DIR;
  
  const canonicalPath = path.join(rootDir, 'specialists', 'unified-registry.json');
  const overlayPath = path.join(rootDir, '.cx', 'unified-registry.json');

  // Check if we need to reload
  let canonicalMtime = null;
  try {
    canonicalMtime = fs.statSync(canonicalPath).mtimeMs;
  } catch (err) {
    throw new Error(`Cannot read canonical registry: ${canonicalPath} - ${err.message}`);
  }

  let overlay = null;
  let overlayMtime = null;
  try {
    overlayMtime = fs.statSync(overlayPath).mtimeMs;
    const overlayContent = fs.readFileSync(overlayPath, 'utf8');
    overlay = JSON.parse(overlayContent);
  } catch (err) {
    // Overlay not found or invalid - use canonical only
    overlay = null;
  }

  // Check if cache is still valid
  if (_registry && _registryMtime === canonicalMtime && _overlayMtime === overlayMtime) {
    return _registry;
  }

  // Load canonical registry
  const canonicalContent = fs.readFileSync(canonicalPath, 'utf8');
  const registry = JSON.parse(canonicalContent);

  // Merge overlay if present (overlay takes precedence)
  if (overlay) {
    mergeRegistry(registry, overlay);
  }

  // Validate
  if (!skipValidation) {
    const result = validate(registry);
    if (!result.ok) {
      throw new Error(`Unified registry validation failed:\n${result.errors.map(e => `  - ${e.id}: ${e.message}`).join('\n')}`);
    }
  }

  // Update cache
  _registry = registry;
  _registryMtime = canonicalMtime;
  _overlayMtime = overlayMtime;

  return registry;
}

/**
 * Merge overlay into registry (overlay takes precedence).
 */
function mergeRegistry(registry, overlay) {
  if (overlay.teams) {
    for (const [id, team] of Object.entries(overlay.teams)) {
      registry.teams[id] = { ...registry.teams[id], ...team };
    }
  }
  if (overlay.specialists) {
    for (const [id, spec] of Object.entries(overlay.specialists)) {
      registry.specialists[id] = { ...registry.specialists[id], ...spec };
    }
  }
  if (overlay.contracts) {
    for (const [id, contract] of Object.entries(overlay.contracts)) {
      registry.contracts[id] = { ...registry.contracts[id], ...contract };
    }
  }
  if (overlay.policies) {
    for (const [id, policy] of Object.entries(overlay.policies)) {
      registry.policies[id] = { ...registry.policies[id], ...policy };
    }
  }
}

/**
 * Get a team by id.
 */
export function getTeam(id) {
  const registry = loadRegistry();
  return registry.teams[id] || null;
}

/**
 * Get a specialist by id (with or without cx- prefix).
 */
export function getSpecialist(id) {
  const registry = loadRegistry();
  const specId = id.startsWith('cx-') ? id : `cx-${id}`;
  return registry.specialists[specId] || null;
}

/**
 * Get a contract by producer and consumer.
 */
export function getContract(producer, consumer) {
  const registry = loadRegistry();
  // Find contract by matching producer and consumer
  for (const [contractId, contract] of Object.entries(registry.contracts)) {
    if (contract.producer === producer && contract.consumer === consumer) {
      return contract;
    }
  }
  return null;
}

/**
 * Get a policy by id.
 */
export function getPolicy(id) {
  const registry = loadRegistry();
  return registry.policies[id] || null;
}

/**
 * List all teams.
 */
export function listTeams() {
  const registry = loadRegistry();
  return Object.entries(registry.teams).map(([id, team]) => ({ id, ...team }));
}

/**
 * List specialists, optionally filtered by team.
 */
export function listSpecialists(teamId) {
  const registry = loadRegistry();
  const specs = Object.entries(registry.specialists).map(([id, spec]) => ({ id, ...spec }));
  if (teamId) {
    return specs.filter(spec => spec.team === teamId);
  }
  return specs;
}

/**
 * Clear the registry cache (for testing).
 */
export function clearCache() {
  _registry = null;
  _registryMtime = null;
  _overlayMtime = null;
}

export default {
  loadRegistry,
  getTeam,
  getSpecialist,
  getContract,
  getPolicy,
  listTeams,
  listSpecialists,
  clearCache,
};
