/**
 * lib/registry/loader.mjs — Unified registry loader (modular org, runtime merge).
 *
 * Assembles specialists/org/** at load time, validates, caches by org dir mtime.
 * Supports legacy .cx/unified-registry.json overlay for specialists/teams only.
 *
 * Export: loadRegistry, getTeam, getSpecialist, getContract, getPolicy,
 *         listTeams, listSpecialists, listGroupsHierarchical, clearCache
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validate } from './validator.mjs';
import { assembleRegistry, orgDirMtime, listTeamsFromRegistry, listGroupsHierarchical } from './assemble.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');

let _registry = null;
let _orgMtime = null;
let _legacyOverlayMtime = null;

function mergeLegacyOverlay(registry, overlay) {
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
  for (const key of ['mcpServers', 'models', 'prefix', 'system', 'orchestrator']) {
    if (overlay[key] !== undefined) registry[key] = overlay[key];
  }
}

export function loadRegistry(opts = {}) {
  const skipValidation = opts.skipValidation === true;
  const rootDir = opts.rootDir ? path.resolve(opts.rootDir) : ROOT_DIR;

  const orgMtime = orgDirMtime(rootDir);
  const legacyOverlayPath = path.join(rootDir, '.cx', 'unified-registry.json');
  let legacyOverlayMtime = null;
  let legacyOverlay = null;
  try {
    legacyOverlayMtime = fs.statSync(legacyOverlayPath).mtimeMs;
    legacyOverlay = JSON.parse(fs.readFileSync(legacyOverlayPath, 'utf8'));
  } catch {
    legacyOverlay = null;
  }

  if (_registry && _orgMtime === orgMtime && _legacyOverlayMtime === legacyOverlayMtime) {
    return _registry;
  }

  const registry = assembleRegistry(rootDir);
  if (legacyOverlay) {
    mergeLegacyOverlay(registry, legacyOverlay);
  }

  if (!skipValidation) {
    const result = validate(registry);
    if (!result.ok) {
      throw new Error(`Unified registry validation failed:\n${result.errors.map((e) => `  - ${e.id}: ${e.message}`).join('\n')}`);
    }
  }

  _registry = registry;
  _orgMtime = orgMtime;
  _legacyOverlayMtime = legacyOverlayMtime;

  return registry;
}

export function getTeam(id, opts = {}) {
  const registry = loadRegistry(opts);
  return registry.teams[id] || null;
}

export function getSpecialist(id, opts = {}) {
  const registry = loadRegistry(opts);
  const specId = id.startsWith('cx-') ? id : `cx-${id}`;
  return registry.specialists[specId] || null;
}

export function getContract(producer, consumer, opts = {}) {
  const registry = loadRegistry(opts);
  for (const contract of Object.values(registry.contracts)) {
    if (contract.producer === producer && contract.consumer === consumer) {
      return contract;
    }
  }
  return null;
}

export function getPolicy(id, opts = {}) {
  const registry = loadRegistry(opts);
  return registry.policies[id] || null;
}

export function listTeams(opts = {}) {
  const registry = loadRegistry(opts);
  return listTeamsFromRegistry(registry, { kind: opts.kind });
}

export { listGroupsHierarchical };

export function listSpecialists(teamId, opts = {}) {
  const registry = loadRegistry(opts);
  const specs = Object.entries(registry.specialists).map(([id, spec]) => ({ id, ...spec }));
  if (!teamId) return specs;
  return specs.filter((spec) => spec.team === teamId || spec.teamId === teamId);
}

export function clearCache() {
  _registry = null;
  _orgMtime = null;
  _legacyOverlayMtime = null;
}

export { assembleRegistry };

export default {
  loadRegistry,
  getTeam,
  getSpecialist,
  getContract,
  getPolicy,
  listTeams,
  listGroupsHierarchical,
  listSpecialists,
  clearCache,
  assembleRegistry,
};
