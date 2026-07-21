/**
 * lib/registry/loader.mjs — Load the canonical Construct registry.
 *
 * The loader exposes only canonical registry nouns. It validates the assembled
 * owner boundary, caches by catalog modification time, and deliberately has no
 * retired overlay, alias, or dual-read API.
 */

import path from 'node:path';
import { packageRoot } from '../roots.mjs';
import { assembleRegistry, registryCatalogMtime } from './assemble.mjs';
import { validate } from './validator.mjs';

const ROOT_DIR = packageRoot;

let cachedRegistry = null;
let cachedRoot = null;
let cachedMtime = null;

export function loadRegistry(opts = {}) {
  const rootDir = opts.rootDir ? path.resolve(opts.rootDir) : ROOT_DIR;
  const mtime = registryCatalogMtime(rootDir);
  if (cachedRegistry && cachedRoot === rootDir && cachedMtime === mtime) return cachedRegistry;

  const registry = assembleRegistry(rootDir);
  if (opts.skipValidation !== true) {
    const result = validate(registry);
    if (!result.ok) {
      throw new Error(`Construct registry validation failed:\n${result.errors.map((entry) => `  - ${entry.id}: ${entry.message}`).join('\n')}`);
    }
  }

  cachedRegistry = registry;
  cachedRoot = rootDir;
  cachedMtime = mtime;
  return registry;
}

export function getWorkspacePreset(id, opts = {}) {
  return loadRegistry(opts).workspacePresets[id] || null;
}

export function getWorkerProfile(id, opts = {}) {
  return loadRegistry(opts).workerProfiles[id] || null;
}

export function getProcedure(id, opts = {}) {
  return loadRegistry(opts).procedures[id] || null;
}

export function getCapability(id, opts = {}) {
  return loadRegistry(opts).capabilities[id] || null;
}

export function getPolicy(id, opts = {}) {
  return loadRegistry(opts).policies[id] || null;
}

export function listWorkspacePresets(opts = {}) {
  return Object.values(loadRegistry(opts).workspacePresets);
}

export function listWorkerProfiles(opts = {}) {
  return Object.values(loadRegistry(opts).workerProfiles);
}

export function listProcedures(opts = {}) {
  return Object.values(loadRegistry(opts).procedures);
}

export function listCapabilities(opts = {}) {
  return Object.values(loadRegistry(opts).capabilities);
}

export function clearCache() {
  cachedRegistry = null;
  cachedRoot = null;
  cachedMtime = null;
}

export { assembleRegistry };

export default {
  loadRegistry,
  getWorkspacePreset,
  getWorkerProfile,
  getProcedure,
  getCapability,
  getPolicy,
  listWorkspacePresets,
  listWorkerProfiles,
  listProcedures,
  listCapabilities,
  clearCache,
  assembleRegistry,
};
